// Cernere service token issuer client (auth-plane consolidation P4, sender side).
// Exchanges this service's project client credentials for a short-lived,
// scope-bearing PASETO aimed at one target project. Credentials are only ever
// sent to Cernere, and the issued token lives in process memory only.

const DEFAULT_FETCH_TIMEOUT_MS = 5_000;
const REFRESH_MARGIN_MS = 60_000;

/** @implements SPEC-AUTH-P4-SERVICE-TOKEN */
class ServiceTokenIssueError extends Error {
  constructor(reason) {
    super(`Cernere service token issuance failed (${reason})`);
    this.name = 'ServiceTokenIssueError';
    this.reason = reason;
  }
}

/** @implements SPEC-AUTH-P4-SERVICE-TOKEN */
function issueFailureReason(status) {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'scope_undeclared';
  if (status === 404) return 'target_not_found';
  return `http_${status}`;
}

/** @implements SPEC-AUTH-P4-SERVICE-TOKEN */
function tokenExpiryMs(body, issuedAt) {
  const expiresIn = Number(body?.expiresIn);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  return issuedAt + expiresIn * 1000;
}

class CernereServiceTokenClient {
  /** @implements SPEC-AUTH-P4-SERVICE-TOKEN */
  constructor({
    baseUrl,
    clientId,
    clientSecret,
    targetProjectKey,
    fetchImpl = fetch,
    now = Date.now,
    fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  }) {
    this.baseUrl = (baseUrl || '').replace(/\/+$/, '');
    this.clientId = clientId || '';
    this.clientSecret = clientSecret || '';
    this.targetProjectKey = targetProjectKey || '';
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.fetchTimeoutMs = fetchTimeoutMs;
    this.cached = null;
    this.pending = null;
  }

  /** @implements SPEC-AUTH-P4-SERVICE-TOKEN */
  isConfigured() {
    return Boolean(this.baseUrl && this.clientId && this.clientSecret && this.targetProjectKey);
  }

  /**
   * Returns a cached token until `exp - 60s`, then issues a fresh one.
   * Concurrent callers share a single in-flight issuance.
   * @implements SPEC-AUTH-P4-SERVICE-TOKEN
   */
  async getToken() {
    if (this.cached && this.now() < this.cached.refreshAt) return this.cached.token;
    if (!this.pending) {
      this.pending = this.issue().finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  /** @implements SPEC-AUTH-P4-SERVICE-TOKEN */
  async issue() {
    if (!this.isConfigured()) throw new ServiceTokenIssueError('not_configured');
    const issuedAt = this.now();
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/auth/service-token`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          target_project_key: this.targetProjectKey,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.fetchTimeoutMs),
      });
    } catch {
      throw new ServiceTokenIssueError('network');
    }
    if (!response.ok) throw new ServiceTokenIssueError(issueFailureReason(response.status));

    let body;
    try {
      body = await response.json();
    } catch {
      throw new ServiceTokenIssueError('invalid_response');
    }
    const expiresAt = tokenExpiryMs(body, issuedAt);
    if (
      typeof body?.accessToken !== 'string'
      || !body.accessToken.startsWith('v4.public.')
      || expiresAt === null
    ) {
      throw new ServiceTokenIssueError('invalid_response');
    }
    this.cached = {
      token: body.accessToken,
      refreshAt: Math.max(issuedAt, expiresAt - REFRESH_MARGIN_MS),
    };
    return body.accessToken;
  }
}

module.exports = {
  CernereServiceTokenClient,
  REFRESH_MARGIN_MS,
  ServiceTokenIssueError,
};
