// Aggregates EvidenceContributions per axis (design §3.0/§5.1): weighted mean,
// provenance retention, and confidence that distinguishes "no signal" from a
// genuine low score.
const PROVENANCE_LIMIT = 20;

function confidenceFor(evidenceWeight, sourceKindCount) {
  if (evidenceWeight >= 4 && sourceKindCount >= 2) return 'high';
  if (evidenceWeight >= 2) return 'medium';
  if (evidenceWeight > 0) return 'low';
  return 'insufficient';
}

function aggregateContributions(contributions) {
  const byAxis = new Map();
  for (const item of contributions) {
    if (!byAxis.has(item.axis)) {
      byAxis.set(item.axis, { total: 0, weight: 0, kinds: new Set(), items: [] });
    }
    const bucket = byAxis.get(item.axis);
    bucket.total += item.value * item.weight;
    bucket.weight += item.weight;
    bucket.kinds.add(item.source?.kind || 'unknown');
    bucket.items.push(item);
  }

  const axes = {};
  for (const [axis, bucket] of byAxis) {
    const score = bucket.weight === 0 ? 0 : bucket.total / bucket.weight;
    axes[axis] = {
      score: Number(score.toFixed(4)),
      evidenceWeight: Number(bucket.weight.toFixed(2)),
      confidence: confidenceFor(bucket.weight, bucket.kinds.size),
      sourceKinds: [...bucket.kinds].sort(),
      contributions: bucket.items
        .slice()
        .sort((left, right) => right.weight - left.weight)
        .slice(0, PROVENANCE_LIMIT)
        .map(({ axis: _axis, ...rest }) => ({
          ...rest,
          value: Number(rest.value.toFixed(4)),
          weight: Number(rest.weight.toFixed(4)),
        })),
    };
  }
  return axes;
}

module.exports = { PROVENANCE_LIMIT, aggregateContributions, confidenceFor };
