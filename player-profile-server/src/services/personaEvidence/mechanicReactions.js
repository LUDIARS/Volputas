// mechanicReactions compartment (design §3.5 / §2): per-mechanic sentiment
// aggregated from voices that name Ludus lexicon ids. polarity fixes the
// direction; the slider supplies intensity.
function effectiveSentiment(record) {
  const sentiment = Number(record.sentiment) || 0;
  if (record.polarity === 'dislike') return -Math.max(1, Math.abs(sentiment));
  if (record.polarity === 'like') return Math.max(1, Math.abs(sentiment));
  return sentiment;
}

function collectMechanicReactions(voices) {
  const byMechanic = new Map();
  for (const record of voices || []) {
    const mechanicIds = record.mechanicIds || [];
    if (mechanicIds.length === 0) continue;
    const sentiment = effectiveSentiment(record);
    for (const mechanicId of mechanicIds) {
      if (!byMechanic.has(mechanicId)) {
        byMechanic.set(mechanicId, { total: 0, count: 0, sources: [] });
      }
      const bucket = byMechanic.get(mechanicId);
      bucket.total += sentiment;
      bucket.count += 1;
      bucket.sources.push(`voice:${record.id || 'unknown'}`);
    }
  }
  return [...byMechanic.entries()]
    .map(([mechanicId, bucket]) => ({
      mechanicId,
      sentiment: Number((bucket.total / bucket.count).toFixed(2)),
      samples: bucket.count,
      sources: bucket.sources,
    }))
    .sort((left, right) => left.mechanicId.localeCompare(right.mechanicId));
}

// Explicit dislikes on named mechanics are first-class aversion evidence.
function mechanicAversionEvidence(voices) {
  const evidence = [];
  for (const record of voices || []) {
    if (record.polarity !== 'dislike') continue;
    const sentiment = Number(record.sentiment) || 0;
    const strength = Number(Math.max(0.5, Math.abs(sentiment) / 2).toFixed(4));
    for (const mechanicId of record.mechanicIds || []) {
      evidence.push({
        target: `mechanic:${mechanicId}`,
        strength,
        source: { kind: 'voice', id: record.id || null, field: 'mechanicIds' },
      });
    }
  }
  return evidence;
}

module.exports = { collectMechanicReactions, mechanicAversionEvidence };
