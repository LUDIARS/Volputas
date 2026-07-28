// Card-sort evidence (design §4.2): only the newest judgment for each
// mechanic is effective. "love" projects through the Ludus category map;
// "avoid" remains a first-class mechanic aversion. The function is pure and
// deterministic so input ordering cannot change the result.
const { MECHANIC_CATEGORY_AXIS_MAP } = require('./axisMappings');

const CARD_SORT_WEIGHT = 1;
const CARD_SORT_AVERSION_STRENGTH = 0.7;
const CARD_SORT_BUCKETS = new Set(['love', 'neutral', 'avoid']);

function recordVersion(record) {
  return [
    String(record.updatedAt || record.createdAt || ''),
    String(record.id || ''),
    String(record.bucket || ''),
  ].join('\u0000');
}

function latestCardSortRecords(records) {
  const byMechanic = new Map();
  for (const record of records || []) {
    if (
      typeof record?.mechanicId !== 'string'
      || !CARD_SORT_BUCKETS.has(record.bucket)
    ) {
      continue;
    }
    const current = byMechanic.get(record.mechanicId);
    if (!current || recordVersion(record) > recordVersion(current)) {
      byMechanic.set(record.mechanicId, record);
    }
  }
  return [...byMechanic.values()]
    .sort((left, right) => left.mechanicId.localeCompare(right.mechanicId));
}

function sourceFor(record) {
  return {
    kind: 'cardsort',
    id: record.id || record.mechanicId,
    field: 'bucket',
  };
}

function reactionFor(record, sentiment) {
  return {
    mechanicId: record.mechanicId,
    sentiment,
    samples: 1,
    sources: [`cardsort:${record.id || record.mechanicId}`],
  };
}

function cardSortContributions(records) {
  const contributions = [];
  const aversionEvidence = [];
  const mechanicReactions = [];

  for (const record of latestCardSortRecords(records)) {
    if (record.bucket === 'love') {
      const category = record.mechanicId.split('/')[0];
      for (const [axis, share] of MECHANIC_CATEGORY_AXIS_MAP[category] || []) {
        contributions.push({
          axis,
          value: 1,
          weight: CARD_SORT_WEIGHT * share,
          source: sourceFor(record),
        });
      }
      mechanicReactions.push(reactionFor(record, 1));
    }

    if (record.bucket === 'avoid') {
      aversionEvidence.push({
        target: `mechanic:${record.mechanicId}`,
        strength: CARD_SORT_AVERSION_STRENGTH,
        source: sourceFor(record),
      });
      mechanicReactions.push(reactionFor(record, -1));
    }
  }

  return { contributions, aversionEvidence, mechanicReactions };
}

module.exports = {
  CARD_SORT_AVERSION_STRENGTH,
  CARD_SORT_WEIGHT,
  cardSortContributions,
  latestCardSortRecords,
};
