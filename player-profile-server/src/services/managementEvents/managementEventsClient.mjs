const REQUEST_TIMEOUT_MS = 5000;

/** @implements SPEC-VO-CC-MANAGEMENT-EVENTS */
export async function postManagementEvent({ url, event, signal, fetchImpl = fetch }) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      redirect: 'manual',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    // Delivery depends on status only. Release the unused response stream.
    const status = response.status;
    response.body?.cancel().catch(() => {
      // The stream may already be closed by the peer or the abort signal.
    });
    if (status >= 200 && status < 300) return { state: 'delivered', status };
    if (status >= 400 && status < 500) return { state: 'refused', status };
    return { state: 'pending', status };
  } catch {
    return { state: 'pending', status: null };
  }
}
