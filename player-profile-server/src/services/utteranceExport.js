const { pseudoId } = require('./pseudoId');

function buildExternalUtterances(rows, secret) {
  const utterances = [];
  for (const row of rows) {
    if (!Array.isArray(row.questions) || !row.answers || typeof row.answers !== 'object') continue;
    const authorId = pseudoId(row.user_id, secret);
    for (const question of row.questions) {
      if (!['freetext', 'free_text', 'text'].includes(question.type)) continue;
      const content = row.answers[question.id];
      if (typeof content !== 'string' || !content.trim()) continue;
      utterances.push({
        source: 'feedback',
        nativeId: `voluptas:${row.response_id}:${question.id}`,
        gameSlug: question.gameSlug || row.game_slug || 'voluptas-survey',
        threadKey: `survey:${row.survey_id}`,
        content: content.trim(),
        lang: row.locale || 'ja',
        postedAt: new Date(row.submitted_at).getTime(),
        authorId,
        sourceUrl: 'voluptas://survey-response',
      });
    }
  }
  return utterances;
}

module.exports = { buildExternalUtterances };
