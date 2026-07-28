const TOKEN_KEY = 'pp_access_token';
const REFRESH_KEY = 'pp_refresh_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setTokens(accessToken, refreshToken) {
  localStorage.setItem(TOKEN_KEY, accessToken);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function isAuthenticated() {
  return !!getToken();
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) throw new Error('No refresh token');

  const res = await fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!res.ok) {
    clearTokens();
    throw new Error('Token refresh failed');
  }

  const { data } = await res.json();
  setTokens(data.access_token, data.refresh_token);
  return data.access_token;
}

export async function api(path, options = {}) {
  const { method = 'GET', body, headers: extraHeaders = {} } = options;
  let token = getToken();

  const headers = { ...extraHeaders };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body && typeof body === 'object') {
    headers['Content-Type'] = 'application/json';
  }

  let res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Auto-refresh on 401
  if (res.status === 401 && localStorage.getItem(REFRESH_KEY)) {
    try {
      token = await refreshAccessToken();
      headers['Authorization'] = `Bearer ${token}`;
      res = await fetch(path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      clearTokens();
      window.location.href = '/login';
      throw new Error('Session expired');
    }
  }

  if (res.status === 204) return { ok: true, data: null };

  const json = await res.json();
  if (!json.ok) {
    const err = new Error(json.error?.message || 'API error');
    err.code = json.error?.code;
    err.status = res.status;
    throw err;
  }

  return json;
}

export async function apiUpload(path, file) {
  let token = getToken();
  let response = await fetch(path, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });
  if (response.status === 401 && localStorage.getItem(REFRESH_KEY)) {
    token = await refreshAccessToken();
    response = await fetch(path, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
    });
  }
  const payload = await response.json().catch(() => ({
    ok: false,
    error: { message: `Upload failed with status ${response.status}` },
  }));
  if (!response.ok || !payload.ok) {
    const error = new Error(payload.error?.message || 'Media upload failed');
    error.code = payload.error?.code;
    throw error;
  }
  return payload.data;
}
