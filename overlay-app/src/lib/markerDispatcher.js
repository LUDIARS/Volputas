// 感想マーカーの投下判断 (spec §感想拾い / task T7)。
// 「送る」「バッファする」の分岐と、セッション開始時の載せ替えをここに閉じる。
// 送信手段は注入するので、取りこぼさない性質を node --test で確かめられる。
import { MarkerQueue } from './markerQueue.js';

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export class MarkerDispatcher {
  constructor({
    postMarker,
    queue = new MarkerQueue(),
    now = () => Date.now(),
    onChange = () => {},
  }) {
    this.postMarker = postMarker;
    this.queue = queue;
    this.now = now;
    this.onChange = onChange;
    this.status = { reachable: false, captureSession: null };
  }

  get pendingCount() {
    return this.queue.size;
  }

  // local app の状態が変わるたびに呼ぶ。録画中になった瞬間に溜まった分を送る。
  async updateStatus(status) {
    const previous = this.status;
    const wasSendable = this.canSend();
    this.status = {
      reachable: Boolean(status?.reachable),
      captureSession: status?.captureSession || null,
    };
    this.onChange(this.state());
    const startedRecording = this.canSend()
      && (!wasSendable
        || !previous.captureSession
        || previous.captureSession.id !== this.status.captureSession.id);
    if (startedRecording) await this.flush();
    return this.state();
  }

  canSend() {
    return Boolean(
      this.status.reachable
      && this.status.captureSession?.status === 'recording'
      && Number.isFinite(Date.parse(this.status.captureSession.startedAt))
    );
  }

  state() {
    return {
      reachable: this.status.reachable,
      recording: this.canSend(),
      pending: this.queue.size,
      overflowed: this.queue.overflowed,
    };
  }

  // 1 回の投下。送れない状態でも必ずバッファし、結果を返して UI に見せる。
  async drop({ type, label = '' }) {
    if (!this.canSend()) {
      const buffered = this.queue.buffer({ type, label, at: this.now() });
      this.onChange(this.state());
      return {
        outcome: buffered.buffered ? 'buffered' : 'overflowed',
        reason: this.status.reachable ? 'no-active-session' : 'local-app-unreachable',
        pending: this.queue.size,
      };
    }
    const flushed = await this.flush();
    // A failed backlog item must stay ahead of this new marker. Sending the
    // new item directly here would invert FIFO order during a brief recovery.
    if (flushed.pending > 0) {
      const buffered = this.queue.buffer({ type, label, at: this.now() });
      this.onChange(this.state());
      return {
        outcome: buffered.buffered ? 'buffered' : 'overflowed',
        reason: flushed.error || 'MARKER_BACKLOG_PENDING',
        pending: this.queue.size,
      };
    }
    const startedAtMs = Date.parse(this.status.captureSession.startedAt);
    const marker = { type, label, sessionMs: Math.max(this.now() - startedAtMs, 0) };
    try {
      await this.postMarker(marker);
      this.onChange(this.state());
      return { outcome: 'sent', pending: this.queue.size };
    } catch (error) {
      this.queue.buffer({ type, label, at: this.now() });
      this.onChange(this.state());
      return {
        outcome: 'buffered',
        reason: error.code || 'MARKER_POST_FAILED',
        pending: this.queue.size,
      };
    }
  }

  // 溜まった投下をセッション時刻へ載せ替えて送る。途中で失敗したら残りを
  // 順序どおり戻す (捨てない)。
  async flush() {
    if (!this.canSend() || this.queue.size === 0) return { sent: 0, pending: this.queue.size };
    const drained = this.queue.drain(this.status.captureSession.startedAt);
    let sent = 0;
    for (let index = 0; index < drained.length; index += 1) {
      try {
        await this.postMarker(drained[index]);
        sent += 1;
      } catch (error) {
        const startedAtMs = Date.parse(this.status.captureSession.startedAt);
        this.queue.restore(drained.slice(index).map((marker) => ({
          type: marker.type,
          label: marker.label,
          at: startedAtMs + marker.sessionMs,
        })));
        this.onChange(this.state());
        return { sent, pending: this.queue.size, error: error.code || 'MARKER_POST_FAILED' };
      }
    }
    this.onChange(this.state());
    return { sent, pending: this.queue.size };
  }
}
