const { createHash } = require('node:crypto');

/** @implements SPEC-VOICE-EXPERIENCE-ANALYSIS */
function analysisError(code, message, statusCode = 502) {
  return Object.assign(new Error(message), { code, statusCode });
}

/** @implements SPEC-VOICE-EXPERIENCE-ANALYSIS */
function voiceSource(record) {
  if (typeof record?.comment !== 'string' || !record.comment.trim()) {
    throw analysisError('VOICE_ANALYSIS_NO_TEXT', '解析する感想がありません。', 400);
  }
  const sources = [{ id: 'comment', text: record.comment }];
  (record.followUps || []).forEach((answer, index) => {
    if (['reason', 'highlight', 'ending'].includes(answer.questionId)
      && typeof answer.answer === 'string' && answer.answer.trim()) {
      sources.push({ id: `followUp:${index}:${answer.questionId}`, text: answer.answer });
    }
  });
  if (sources.reduce((sum, source) => sum + source.text.length, 0) > 24000) {
    throw analysisError('VOICE_ANALYSIS_TEXT_LIMIT', '解析対象の文章が長すぎます。', 400);
  }
  // Whitelist: never send respondent names, identity, or stored prior analyses.
  return {
    gameId: record.gameId ?? null,
    gameTitle: record.gameTitle ?? '',
    scopeType: record.scopeType ?? 'game',
    contentName: record.contentName ?? '',
    playProgress: record.playProgress ?? null,
    sentiment: record.sentiment ?? null,
    polarity: record.polarity ?? null,
    mechanicIds: record.mechanicIds ?? [],
    sources,
  };
}

/** @implements SPEC-VOICE-EXPERIENCE-ANALYSIS */
function sourceRevision(record) {
  return createHash('sha256').update(JSON.stringify(voiceSource(record))).digest('hex');
}

module.exports = { analysisError, voiceSource, sourceRevision };
