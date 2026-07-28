class MemoriaServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || '').trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new MemoriaServiceError('MEMORIA_INVALID_URL', 'Memoria base URL must start with http:// or https://');
  }
  return trimmed.replace(/\/+$/, '');
}

// GET {baseUrl}/api/external/personality-features — Bearerトークンで保護された、
// Memoria側の集計済み特徴量エンドポイントを叩く。 404 は「機能OFF or トークン無効/失効」を
// 意味する (Memoria側が存在を匂わせないため一律404で返す設計、詳細メッセージは無い)。
async function fetchPersonalityFeatures(baseUrl, token) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!token) throw new MemoriaServiceError('MEMORIA_TOKEN_REQUIRED', 'Memoria token is required');

  let res;
  try {
    res = await fetch(`${normalized}/api/external/personality-features`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new MemoriaServiceError('MEMORIA_UNREACHABLE', `Could not reach Memoria: ${e.message}`);
  }

  if (res.status === 404) {
    throw new MemoriaServiceError('MEMORIA_NOT_AVAILABLE', 'Memoria export is disabled, or the token is invalid/expired');
  }
  if (!res.ok) {
    throw new MemoriaServiceError('MEMORIA_API_ERROR', `Memoria API error (${res.status})`);
  }

  const json = await res.json();
  if (!Array.isArray(json.axes)) {
    throw new MemoriaServiceError('MEMORIA_INVALID_RESPONSE', 'Unexpected response from Memoria');
  }
  return json;
}

module.exports = { MemoriaServiceError, normalizeBaseUrl, fetchPersonalityFeatures };
