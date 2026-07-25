const { randomUUID } = require('node:crypto');
const WebSocket = require('ws');
const { z } = require('zod');
const {
  CernereConfigurationError,
  CernereIntegrationError,
} = require('./cernereErrors');

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
// The HTTP ingress accepts 1 MiB answer bodies. Cernere wraps normalized
// answers in a module_response envelope, so leave bounded headroom for that
// response without inheriting Cernere's broader 16 MiB project-WS limit.
const MAX_WEBSOCKET_PAYLOAD_BYTES = 2 * 1024 * 1024;
const CLIENT_CLOSED_MESSAGE = 'Cernere project client is closed';

const loginResponseSchema = z.object({
  accessToken: z.string().min(1).max(10_000),
}).passthrough();

const serverMessageSchema = z.object({
  type: z.enum(['connected', 'module_response', 'error', 'ping', 'pong']),
  request_id: z.string().min(1).optional(),
  payload: z.unknown().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  ts: z.number().optional(),
}).passthrough();

function appendPath(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function websocketUrl(baseUrl) {
  const parsed = new URL(appendPath(baseUrl, '/ws/project'));
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  return parsed.toString();
}

class CernereProjectSocketClient {
  constructor({
    baseUrl,
    clientId,
    clientSecret,
    fetchImpl = fetch,
    createWebSocket = (url, protocols, options) => new WebSocket(url, protocols, options),
    openState = WebSocket.OPEN,
    closedState = WebSocket.CLOSED,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    requestId = () => `volputas-${randomUUID()}`,
  }) {
    this.baseUrl = baseUrl;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetchImpl = fetchImpl;
    this.createWebSocket = createWebSocket;
    this.openState = openState;
    this.closedState = closedState;
    this.requestTimeoutMs = requestTimeoutMs;
    this.requestId = requestId;
    this.socket = null;
    this.connection = null;
    this.connections = new Set();
    this.connectionGeneration = 0;
    this.connectPromise = null;
    this.loginController = null;
    this.pending = new Map();
    this.closed = false;
    this.closePromise = null;
    // Single lifecycle queue: every start/stop transition runs to completion
    // before the next one begins, so concurrent callers can never interleave
    // two connect attempts (or a connect and a shutdown) on this client.
    this.lifecycleChain = Promise.resolve();
  }

  // Serializes lifecycle transitions. Prior failures never poison the queue.
  runExclusive(task) {
    const run = this.lifecycleChain.then(() => task());
    this.lifecycleChain = run.then(() => undefined, () => undefined);
    return run;
  }

  // Explicit lifecycle entry point (the "start" half of start/stop).
  async start() {
    await this.ensureConnected();
  }

  async request(module, action, payload) {
    this.assertActive();
    if (!/^[a-z][a-z0-9_]*$/i.test(module) || !/^[a-z][a-z0-9_]*$/i.test(action)) {
      throw new CernereIntegrationError('Invalid Cernere project command');
    }
    await this.ensureConnected();
    this.assertActive();
    const connection = this.connection;
    if (!this.isOpen(connection)) {
      throw new CernereIntegrationError('Cernere project WebSocket is not connected');
    }

    const requestId = this.requestId();
    return new Promise((resolve, reject) => {
      const pending = {
        resolve,
        reject,
        timer: null,
        generation: connection.generation,
      };
      const timer = setTimeout(() => {
        if (this.pending.get(requestId) !== pending) return;
        this.pending.delete(requestId);
        reject(new CernereIntegrationError(`Cernere request timed out: ${module}.${action}`));
        // A silent request is indistinguishable from a half-open TCP peer, so
        // the connection is retired instead of reused. Reusing it would make
        // every later request time out against the same dead socket.
        this.retireConnection(
          connection,
          new CernereIntegrationError('Cernere project WebSocket retired after a request timeout'),
        );
      }, this.requestTimeoutMs);
      timer.unref?.();
      pending.timer = timer;
      this.pending.set(requestId, pending);
      try {
        connection.socket.send(JSON.stringify({
          type: 'module_request',
          request_id: requestId,
          module,
          action,
          payload,
        }));
      } catch {
        clearTimeout(timer);
        if (this.pending.get(requestId) === pending) {
          this.pending.delete(requestId);
        }
        reject(new CernereIntegrationError('Failed to send Cernere project request'));
      }
    });
  }

  isReady(connection = this.connection) {
    return this.isOpen(connection) && connection.authenticated;
  }

  async ensureConnected() {
    this.assertActive();
    if (this.isReady()) return;
    if (!this.connectPromise) {
      let attempt;
      attempt = this.runExclusive(() => {
        // Re-checked inside the queue: the state may have changed while this
        // attempt waited behind another transition.
        if (this.closed) throw clientClosedError();
        if (this.isReady()) return undefined;
        return this.connect();
      }).finally(() => {
        if (this.connectPromise === attempt) this.connectPromise = null;
      });
      this.connectPromise = attempt;
    }
    await this.connectPromise;
    this.assertActive();
  }

  async connect() {
    this.assertActive();
    this.assertConfigured();
    const token = await this.login();
    this.assertActive();

    let socket;
    try {
      socket = this.createWebSocket(
        websocketUrl(this.baseUrl),
        ['bearer', token],
        { maxPayload: MAX_WEBSOCKET_PAYLOAD_BYTES },
      );
    } catch {
      throw new CernereIntegrationError('Failed to create Cernere project WebSocket');
    }
    const generation = this.connectionGeneration + 1;
    this.connectionGeneration = generation;
    let resolveClosed;
    const closedPromise = new Promise((resolve) => {
      resolveClosed = resolve;
    });
    const connection = {
      socket,
      generation,
      authenticated: false,
      closed: false,
      retired: false,
      finishAuthentication: null,
      closedPromise,
      resolveClosed,
      closeRequested: false,
      terminationTimer: null,
    };
    this.connections.add(connection);
    this.connection = connection;
    this.socket = socket;

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else {
          connection.authenticated = true;
          resolve();
        }
      };

      const timer = setTimeout(() => {
        finish(new CernereIntegrationError('Cernere project WebSocket authentication timed out'));
        this.requestSocketClose(connection);
      }, this.requestTimeoutMs);
      timer.unref?.();

      connection.finishAuthentication = {
        resolve: () => finish(),
        reject: (error = new CernereIntegrationError(
          'Cernere project WebSocket authentication failed',
        )) => finish(error),
      };

      socket.on('message', (raw) => this.handleMessage(connection, raw));
      socket.on('error', () => this.handleSocketError(connection));
      socket.on('close', () => this.handleSocketClose(connection));

      if (this.closed) {
        finish(clientClosedError());
        this.requestSocketClose(connection);
      }
    });
  }

  async login() {
    this.assertActive();
    const controller = new AbortController();
    this.loginController = controller;
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(
        appendPath(this.baseUrl, '/api/auth/login'),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'project_credentials',
            client_id: this.clientId,
            client_secret: this.clientSecret,
          }),
          signal: controller.signal,
          redirect: 'error',
        },
      );
      if (!response.ok) {
        throw new CernereIntegrationError(`Cernere project login failed (${response.status})`);
      }
      const parsed = loginResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new CernereIntegrationError('Cernere project login returned an invalid response');
      }
      return parsed.data.accessToken;
    } catch (error) {
      if (this.closed) throw clientClosedError();
      if (error instanceof CernereIntegrationError) throw error;
      throw new CernereIntegrationError('Cernere project login failed');
    } finally {
      clearTimeout(timer);
      if (this.loginController === controller) this.loginController = null;
    }
  }

  handleMessage(connection, raw) {
    if (
      this.connection !== connection
      || connection.closed
      || connection.retired
      || this.closed
    ) return;
    let value;
    try {
      value = JSON.parse(String(raw));
    } catch {
      this.failProtocol(connection);
      return;
    }
    const parsed = serverMessageSchema.safeParse(value);
    if (!parsed.success) {
      this.failProtocol(connection);
      return;
    }
    const message = parsed.data;

    if (message.type === 'connected') {
      connection.finishAuthentication?.resolve();
      return;
    }
    if (message.type === 'ping') {
      if (!this.isOpen(connection)) return;
      try {
        connection.socket.send(JSON.stringify({ type: 'pong', ts: message.ts }));
      } catch {
        this.failProtocol(connection);
      }
      return;
    }
    if (!['module_response', 'error'].includes(message.type)) return;
    if (!message.request_id) {
      this.failProtocol(connection);
      return;
    }

    const pending = this.pending.get(message.request_id);
    if (!pending || pending.generation !== connection.generation) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.request_id);
    if (message.type === 'error') {
      pending.reject(new CernereIntegrationError('Cernere project command failed'));
      return;
    }
    pending.resolve(message.payload);
  }

  handleSocketError(connection) {
    const error = new CernereIntegrationError('Cernere project WebSocket failed');
    connection.finishAuthentication?.reject(error);
    this.rejectPending(error, connection.generation);
    if (this.connection === connection) this.requestSocketClose(connection);
  }

  handleSocketClose(connection) {
    if (connection.closed) return;
    connection.closed = true;
    clearTimeout(connection.terminationTimer);
    connection.terminationTimer = null;
    connection.finishAuthentication?.reject(
      new CernereIntegrationError('Cernere project WebSocket authentication failed'),
    );
    this.rejectPending(
      new CernereIntegrationError('Cernere project WebSocket closed'),
      connection.generation,
    );
    if (this.connection === connection) {
      this.connection = null;
      this.socket = null;
    }
    this.connections.delete(connection);
    connection.resolveClosed();
  }

  failProtocol(connection) {
    const error = new CernereIntegrationError('Cernere project WebSocket protocol error');
    connection.finishAuthentication?.reject(error);
    this.rejectPending(error, connection.generation);
    this.requestSocketClose(connection);
  }

  rejectPending(error, generation) {
    for (const [requestId, pending] of this.pending.entries()) {
      if (generation !== undefined && pending.generation !== generation) continue;
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
      pending.reject(error);
    }
  }

  isOpen(connection = this.connection) {
    return Boolean(
      connection
      && !connection.closed
      && !connection.retired
      && connection.socket.readyState === this.openState,
    );
  }

  // Detaches a connection from the client immediately, then closes it in the
  // background. The generation counter guarantees that anything still in
  // flight on the retired socket can no longer touch a newer generation's
  // pending requests, and the next request reconnects from scratch.
  retireConnection(connection, error) {
    if (!connection || connection.retired || connection.closed) return;
    connection.retired = true;
    connection.authenticated = false;
    if (this.connection === connection) {
      this.connection = null;
      this.socket = null;
    }
    this.rejectPending(error, connection.generation);
    this.requestSocketClose(connection);
  }

  requestSocketClose(connection) {
    if (!connection || connection.closed) return;
    if (connection.socket.readyState === this.closedState) {
      this.handleSocketClose(connection);
      return;
    }
    if (!connection.terminationTimer) {
      connection.terminationTimer = setTimeout(() => {
        if (connection.closed) return;
        try {
          connection.socket.terminate?.();
        } finally {
          this.handleSocketClose(connection);
        }
      }, this.requestTimeoutMs);
      connection.terminationTimer.unref?.();
    }
    if (connection.closeRequested) return;
    connection.closeRequested = true;
    try {
      connection.socket.close();
    } catch {
      try {
        connection.socket.terminate?.();
      } finally {
        this.handleSocketClose(connection);
      }
    }
  }

  async waitForSocketClose(connection) {
    if (!connection || connection.closed) return;
    this.requestSocketClose(connection);
    if (connection.closed) return;

    let timeout;
    const timedOut = await Promise.race([
      connection.closedPromise.then(() => false),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(true), this.requestTimeoutMs);
      }),
    ]);
    clearTimeout(timeout);
    if (!timedOut || connection.closed) return;

    try {
      connection.socket.terminate?.();
    } finally {
      this.handleSocketClose(connection);
    }
  }

  assertConfigured() {
    if (
      !this.baseUrl
      || !this.clientId
      || !this.clientSecret
    ) {
      throw new CernereConfigurationError(
        'Cernere project credentials are required for Corpus integration',
      );
    }
  }

  assertActive() {
    if (this.closed) throw clientClosedError();
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    const error = clientClosedError();
    this.loginController?.abort();
    const connectPromise = this.connectPromise;
    const connectionsAtClose = [...this.connections];
    for (const activeConnection of connectionsAtClose) {
      activeConnection.finishAuthentication?.reject(error);
    }
    this.rejectPending(error);
    // Signalled synchronously so an in-flight connect cannot outlive close();
    // the queued drain below only waits for the sockets to finish closing.
    const drains = connectionsAtClose.map((activeConnection) => (
      this.waitForSocketClose(activeConnection)
    ));

    this.closePromise = (async () => {
      await Promise.all(drains);
      if (connectPromise) {
        try {
          await connectPromise;
        } catch {
          // Terminal shutdown intentionally consumes the in-flight connect failure.
        }
      }
      // Join the lifecycle queue so any transition started before close() has
      // fully settled before the client reports itself stopped.
      await this.runExclusive(() => undefined).catch(() => undefined);
      while (this.connections.size > 0) {
        await Promise.all(
          [...this.connections].map((activeConnection) => (
            this.waitForSocketClose(activeConnection)
          )),
        );
      }
      this.connection = null;
      this.socket = null;
    })();
    return this.closePromise;
  }
}

function clientClosedError() {
  return new CernereIntegrationError(CLIENT_CLOSED_MESSAGE);
}

module.exports = {
  CernereProjectSocketClient,
  appendPath,
  websocketUrl,
};
