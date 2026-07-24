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

  async ensureConnected() {
    this.assertActive();
    if (this.isOpen(this.connection) && this.connection.authenticated) return;
    if (!this.connectPromise) {
      let attempt;
      attempt = this.connect().finally(() => {
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
    if (this.connection !== connection || connection.closed || this.closed) return;
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
      && connection.socket.readyState === this.openState,
    );
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
    const connection = this.connection;
    const connectPromise = this.connectPromise;
    const connectionsAtClose = [...this.connections];
    connection?.finishAuthentication?.reject(error);
    this.rejectPending(error);

    this.closePromise = (async () => {
      await Promise.all(
        connectionsAtClose.map((activeConnection) => (
          this.waitForSocketClose(activeConnection)
        )),
      );
      if (connectPromise) {
        try {
          await connectPromise;
        } catch {
          // Terminal shutdown intentionally consumes the in-flight connect failure.
        }
      }
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
