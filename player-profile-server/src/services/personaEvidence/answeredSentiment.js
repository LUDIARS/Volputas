// A voice's sentiment is null while the player has not answered it. That is
// different from an explicit 中立 (0): numeric emotion signals must skip the
// record instead of counting it as a calm, neutral reaction.
function answeredSentiment(record) {
  const value = record?.sentiment;
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

module.exports = { answeredSentiment };
