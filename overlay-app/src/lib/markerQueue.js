// 感想マーカーのオフラインバッファ (spec §感想拾い / task T7)。
// キャプチャセッションが無い間の投下を必ず保持し、セッション開始時に
// sessionMs へ載せ替えて送る。純粋ロジックなので node --test で検証する。
const MAXIMUM_PENDING = 1000;

export const MARKER_TYPES = Object.freeze(['hype', 'like', 'dislike', 'stress']);

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export function isMarkerType(value) {
  return MARKER_TYPES.includes(String(value));
}

// 送信済みセッションの開始時刻を基準に sessionMs を作る。開始前に打たれた
// マーカーは 0ms に丸める (捨てない)。
/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export function rebaseMarker(marker, startedAtMs) {
  const sessionMs = Math.max(Math.round(marker.at - startedAtMs), 0);
  return { type: marker.type, label: marker.label || '', sessionMs };
}

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export class MarkerQueue {
  constructor({ now = () => Date.now(), maximumPending = MAXIMUM_PENDING } = {}) {
    this.now = now;
    this.maximumPending = maximumPending;
    this.pending = [];
    this.overflowed = 0;
  }

  get size() {
    return this.pending.length;
  }

  // セッションが無いとき用。戻り値でバッファされた事実を UI に見せるので、
  // 「無言で捨てる」経路を作らない。
  buffer({ type, label = '', at = this.now() }) {
    if (!isMarkerType(type)) {
      throw Object.assign(new Error(`Unknown marker type: ${type}`), { code: 'UNKNOWN_MARKER_TYPE' });
    }
    if (this.pending.length >= this.maximumPending) {
      this.overflowed += 1;
      return { buffered: false, overflowed: true, size: this.pending.length };
    }
    this.pending.push({ type, label: String(label || ''), at });
    return { buffered: true, overflowed: false, size: this.pending.length };
  }

  // 送信できる状態になったら投下順のまま払い出す。呼び出し側が送信に失敗
  // したときは restore() で戻せる。
  drain(startedAt) {
    const startedAtMs = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt);
    if (!Number.isFinite(startedAtMs)) {
      throw Object.assign(new Error('Session startedAt is not a timestamp'), {
        code: 'INVALID_SESSION_START',
      });
    }
    const drained = this.pending.map((marker) => rebaseMarker(marker, startedAtMs));
    this.pending = [];
    return drained;
  }

  restore(markers) {
    const restored = [...markers, ...this.pending];
    const discarded = Math.max(restored.length - this.maximumPending, 0);
    this.pending = restored.slice(0, this.maximumPending);
    this.overflowed += discarded;
    return this.pending.length;
  }

  toJSON() {
    return { schemaVersion: 1, pending: this.pending, overflowed: this.overflowed };
  }

  static from(value, options = {}) {
    const queue = new MarkerQueue(options);
    const pending = Array.isArray(value?.pending) ? value.pending : [];
    queue.pending = pending
      .filter((marker) => isMarkerType(marker?.type) && Number.isFinite(Number(marker?.at)))
      .map((marker) => ({ type: marker.type, label: String(marker.label || ''), at: Number(marker.at) }))
      .slice(0, queue.maximumPending);
    queue.overflowed = Number(value?.overflowed) || 0;
    return queue;
  }
}
