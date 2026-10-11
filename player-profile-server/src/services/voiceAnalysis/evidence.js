const { analysisError } = require('./source');

/** @implements SPEC-VOICE-EXPERIENCE-ANALYSIS */
function invalid() {
  return analysisError('VOICE_ANALYSIS_INVALID_RESPONSE',
    '解析結果の形式または原文の根拠を確認できませんでした。再度解析してください。');
}

/** @implements SPEC-VOICE-EXPERIENCE-ANALYSIS */
function boundedText(value, max = 240) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid();
  return value.trim();
}

/** @implements SPEC-VOICE-EXPERIENCE-ANALYSIS */
function boundedArray(value, max) {
  if (!Array.isArray(value) || value.length > max) throw invalid();
  return value;
}

/** @implements SPEC-VOICE-EXPERIENCE-ANALYSIS */
function resolveEvidence(raw, sources) {
  if (!raw || typeof raw !== 'object') throw invalid();
  const source = sources.find((item) => item.id === raw.sourceId);
  if (!source || typeof raw.quote !== 'string' || !raw.quote.trim() || raw.quote.length > 2000) {
    throw invalid();
  }
  const positions = [];
  let position = source.text.indexOf(raw.quote);
  while (position !== -1) {
    positions.push(position);
    position = source.text.indexOf(raw.quote, position + 1);
  }
  const occurrence = raw.occurrence ?? (positions.length === 1 ? 0 : -1);
  if (!Number.isInteger(occurrence) || occurrence < 0 || occurrence >= positions.length) throw invalid();
  const start = [...source.text.slice(0, positions[occurrence])].length;
  return {
    sourceId: source.id, quote: raw.quote,
    startInclusive: start, endExclusive: start + [...raw.quote].length,
    coordinate: 'unicode-code-point',
  };
}

module.exports = { invalid, boundedText, boundedArray, resolveEvidence };
