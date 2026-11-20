// クライアント → サーバのフレーム (SPEC-VO-PLAY-STREAM-FRAMES)。どれも strict で、未知の項目は拒否する。
// 記録の中身 (event_data) は既存の ludellus.* 検査 (trialResultSchema.js) にそのまま掛ける。

const { z } = require('zod');
const { TRIAL_RESULT_EVENT_TYPE, METRIC_EVENT_TYPE } = require('../services/trialResult');
const { validateLudellusEvent } = require('../services/trialResultSchema');

const idText = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/);
const isoTime = z.iso.datetime({ offset: true });
const sessionId = z.uuid();
const metadataValue = z.union([z.string().max(64), z.number().finite(), z.boolean()]);

const sessionStartFrame = z.object({
  type: z.literal('session_start'),
  sessionId,
  seq: z.literal(0),
  gameId: idText,
  startedAt: isoTime,
  // §5 のセッション環境情報 (mode / platform / app_version など)。派生値だけの浅い表。
  metadata: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), metadataValue)
    .refine((value) => Object.keys(value).length <= 16, { message: 'too many metadata keys' })
    .optional(),
}).strict();

const eventFrame = z.object({
  type: z.literal('event'),
  sessionId,
  seq: z.number().int().min(1).max(1_000_000),
  eventType: z.enum([TRIAL_RESULT_EVENT_TYPE, METRIC_EVENT_TYPE]),
  eventData: z.record(z.string(), z.unknown()),
}).strict();

const sessionEndFrame = z.object({
  type: z.literal('session_end'),
  sessionId,
  seq: z.number().int().min(1).max(1_000_000),
  endedAt: isoTime,
  reason: z.enum(['completed', 'abandoned']),
}).strict();

const frameSchema = z.discriminatedUnion('type', [sessionStartFrame, eventFrame, sessionEndFrame]);

/**
 * テキストメッセージ 1 つを検証する。失敗時も、読めた範囲の sessionId / seq を返す。
 * event は event_data.seq がフレームの seq と一致し、ludellus.* の検査を通ることまで見る。
 * @returns {{ ok: true, frame: object } | { ok: false, sessionId?: string, seq?: number, detail?: string }}
 * @implements SPEC-VO-PLAY-STREAM-FRAMES
 */
function parsePlayStreamFrame(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  const parsed = frameSchema.safeParse(value);
  if (!parsed.success) return { ok: false, ...echoIds(value) };
  const frame = parsed.data;
  if (frame.type === 'event') {
    if (frame.eventData.seq !== frame.seq) {
      return { ok: false, ...echoIds(frame), detail: 'event_data.seq must equal seq' };
    }
    const errors = validateLudellusEvent(frame.eventType, frame.eventData);
    if (errors.length > 0) return { ok: false, ...echoIds(frame), detail: errors.join('; ') };
  }
  return { ok: true, frame };
}

function echoIds(value) {
  if (!value || typeof value !== 'object') return {};
  const ids = {};
  if (sessionId.safeParse(value.sessionId).success) ids.sessionId = value.sessionId;
  if (Number.isInteger(value.seq)) ids.seq = value.seq;
  return ids;
}

module.exports = { parsePlayStreamFrame };
