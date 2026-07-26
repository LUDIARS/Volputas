const WebSocket = require('ws');

const OPEN = 1;
const REQUEST_TIMEOUT_MS = 10_000;

function projectWebSocketUrl(baseUrl) {
  return `${baseUrl.replace(/\/+$/, '').replace(/^http/i, 'ws')}/ws/project`;
}

class CernereProjectSocketClient {
  constructor({
    baseUrl,
    clientId,
    clientSecret,
    fetchImpl = fetch,
    createWebSocket = (url, protocols) => new WebSocket(url, protocols),
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
    now = () => Date.now(),
  }) {
    if (!baseUrl) throw new Error('CERNERE_BASE_URL is required in online mode');
    if (!clientId) throw new Error('CERNERE_PROJECT_CLIENT_ID is required in online mode');
    if (!clientSecret) throw new Error('CERNERE_PROJECT_CLIENT_SECRET is required in online mode');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetchImpl = fetchImpl;
    this.createWebSocket = createWebSocket;
    this.requestTimeoutMs = requestTimeoutMs;
    this.now = now;
    this.socket = null;
    this.connecting = null;
    this.sequence = 0;
    this.pending = new Map();
  }

  async request(module, action, payload) {
    await this.ensureConnected();
    if (!this.socket || this.socket.readyState !== OPEN) {
      throw new Error('Cernere project WebSocket is not connected');
    }
    const requestId = `volputas-${this.now()}-${this.sequence++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Cernere request timed out: ${module}.${action}`));
      }, this.requestTimeoutMs);
      timer.unref?.();
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({
          type: 'module_request',
          request_id: requestId,
          module,
          action,
          payload,
        }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  async ensureConnected() {
    if (this.socket?.readyState === OPEN) return;
    if (!this.connecting) {
      this.connecting = this.connect().finally(() => {
        this.connecting = null;
      });
    }
    await this.connecting;
  }

  async connect() {
    const token = await this.fetchProjectToken();
    await new Promise((resolve, reject) => {
      const socket = this.createWebSocket(projectWebSocketUrl(this.baseUrl), ['bearer', token]);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.socket = null;
        socket.close();
        reject(new Error('Cernere project WebSocket authentication timed out'));
      }, this.requestTimeoutMs);
      timer.unref?.();
      this.socket = socket;

      socket.on('message', (raw) => {
        const message = this.parseMessage(raw);
        if (!message) return;
        if (message.type === 'connected' && !settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
          return;
        }
        if (message.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', ts: message.ts }));
          return;
        }
        this.handleResponse(message);
      });
      socket.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.socket = null;
        reject(error);
      });
      socket.on('close', (code) => {
        this.socket = null;
        this.rejectPending(new Error(`Cernere project WebSocket closed (${code})`));
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Cernere project WebSocket closed before authentication (${code})`));
        }
      });
    });
  }

  async fetchProjectToken() {
    const response = await this.fetchImpl(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'project_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    if (!response.ok) throw new Error(`Cernere project login failed: HTTP ${response.status}`);
    const body = await response.json();
    if (typeof body.accessToken !== 'string' || !body.accessToken) {
      throw new Error('Cernere project login response is missing accessToken');
    }
    return body.accessToken;
  }

  handleResponse(message) {
    const requestId = typeof message.request_id === 'string' ? message.request_id : null;
    const pending = requestId ? this.pending.get(requestId) : null;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    if (message.type === 'module_response') {
      pending.resolve(message.payload ?? {});
    } else {
      pending.reject(new Error(
        typeof message.message === 'string' ? message.message : 'Cernere request failed'
      ));
    }
  }

  parseMessage(raw) {
    try {
      return JSON.parse(String(raw));
    } catch {
      return null;
    }
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    this.rejectPending(new Error('Cernere project client closed'));
    this.socket?.close();
    this.socket = null;
    this.connecting = null;
  }
}

module.exports = { CernereProjectSocketClient, projectWebSocketUrl };
