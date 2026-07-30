// Combines already-aggregated mechanic-reaction groups without losing sample
// weights. This keeps source-specific extraction modules independent while
// producing one deterministic persona.json compartment.
function combineMechanicReactions(...groups) {
  const byMechanic = new Map();
  for (const reaction of groups.flat()) {
    const samples = Number(reaction?.samples) > 0 ? Number(reaction.samples) : 1;
    if (!reaction?.mechanicId || !Number.isFinite(Number(reaction.sentiment))) continue;
    if (!byMechanic.has(reaction.mechanicId)) {
      byMechanic.set(reaction.mechanicId, { total: 0, samples: 0, sources: new Set() });
    }
    const bucket = byMechanic.get(reaction.mechanicId);
    bucket.total += Number(reaction.sentiment) * samples;
    bucket.samples += samples;
    for (const source of reaction.sources || []) bucket.sources.add(source);
  }

  return [...byMechanic.entries()]
    .map(([mechanicId, bucket]) => ({
      mechanicId,
      sentiment: Number((bucket.total / bucket.samples).toFixed(2)),
      samples: bucket.samples,
      sources: [...bucket.sources].sort(),
    }))
    .sort((left, right) => left.mechanicId.localeCompare(right.mechanicId));
}

module.exports = { combineMechanicReactions };
