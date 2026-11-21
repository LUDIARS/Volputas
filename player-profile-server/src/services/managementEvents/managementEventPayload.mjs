import { createHash } from 'node:crypto';

const PROJECT_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const KEY_PART = /^[A-Za-z0-9._:/#-]+$/;
const SUMMARY_LIMIT = 2000;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function gameKeys(gameId) {
  const normalized = gameId.normalize('NFKC').trim();
  const projectCode = PROJECT_CODE.test(normalized) ? normalized : `game-${digest(gameId).slice(0, 32)}`;
  return {
    project_code: projectCode,
    target_key: `game/${KEY_PART.test(gameId) && gameId.length <= 195 ? gameId : projectCode}`,
  };
}

function concise(text, limit) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/u, '').trimEnd()}…`;
}

function redactReviewText(text, runId) {
  return text.normalize('NFKC')
    .replace(/https?:\/\/\S+/giu, '[URL]')
    .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, '[メール]')
    .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, '[ID]')
    .replace(/<@!?\d+>|\b\d{15,}\b/g, '[ID]')
    .replace(/(?:\+\d[\d(). -]{7,}\d|\b0\d{1,4}[- ]\d{1,4}[- ]\d{3,4}\b)/g, '[電話番号]')
    .replace(/\b(?:user[_ -]?id|email|session[_ -]?id|run[_ -]?id)\s*[:=]\s*[^\s,;]+/gi, '[識別情報]')
    .replaceAll(runId.normalize('NFKC'), '[ID]')
    .trim();
}

function summarizeReview(review) {
  const clean = (text, limit) => concise(redactReviewText(text, review.run_id), limit);
  const sections = [clean(review.game_title, 200), clean(review.summary, 400)];
  for (const [label, points] of [['良い点', review.good], ['悪い点', review.bad], ['迷った点', review.confusions]]) {
    const highlights = points.slice(0, 2).map(({ text }) => clean(text, 210)).filter(Boolean);
    if (highlights.length) sections.push(`${label} ${highlights.join(' / ')}`);
  }
  return concise(sections.filter(Boolean).join('\n'), SUMMARY_LIMIT);
}

/** @implements SPEC-VO-CC-MANAGEMENT-EVENTS */
export function toAiManagementEvent(review) {
  const runId = KEY_PART.test(review.run_id) && review.run_id.length <= 185
    ? review.run_id : `sha256/${digest(review.run_id)}`;
  return {
    event_key: `vo:ai-playtest:${runId}`,
    source: 'vo',
    kind: 'ai-playtest-review',
    ...gameKeys(review.game_id),
    origin: 'ai',
    summary: summarizeReview(review),
    observed_at: new Date(review.played_at ?? review.created_at).getTime(),
  };
}

/** @implements SPEC-VO-CC-MANAGEMENT-EVENTS */
export function toHumanManagementEvent(impression) {
  return {
    event_key: `vo:play-impression:${impression.id}`,
    source: 'vo',
    kind: 'play-impression',
    ...gameKeys(impression.game_id),
    origin: 'human',
    summary: 'プレイ感想が保存されました。',
    observed_at: new Date(impression.captured_at ?? impression.created_at).getTime(),
  };
}
