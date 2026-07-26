export async function localApi(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({
    ok: false,
    error: { message: `Request failed with status ${response.status}` },
  }));

  if (!response.ok || !payload.ok) {
    const error = new Error(payload.error?.message || 'Local request failed');
    error.code = payload.error?.code;
    throw error;
  }
  return payload.data;
}

export async function localUpload(path, file) {
  const response = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
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
