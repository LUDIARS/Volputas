// Ideal-game pitch evidence (design §4.4). Authorship itself activates
// creative/autonomous preferences, while explicit Ludus vocabulary projects
// through the same category map as card sort. Pitch body text also feeds the
// deterministic affect vector.
const { MECHANIC_CATEGORY_AXIS_MAP } = require('./axisMappings');
const { extractPitchMechanicIds } = require('./pitchMechanicExtraction');

const PITCH_WEIGHT = 1;
const AUTHORSHIP_VALUE = 0.6;

function sourceFor(record, field = 'body') {
  return {
    kind: 'pitch',
    id: record.id || 'unknown',
    field,
  };
}

function pitchContributions(records) {
  const contributions = [];
  const affectSamples = [];
  const mechanicReactions = [];

  for (const record of records || []) {
    if (typeof record?.body !== 'string' || !record.body.trim()) continue;
    contributions.push(
      {
        axis: 'mtg.johnny',
        value: AUTHORSHIP_VALUE,
        weight: PITCH_WEIGHT,
        source: sourceFor(record),
      },
      {
        axis: 'style.autonomy',
        value: AUTHORSHIP_VALUE,
        weight: PITCH_WEIGHT,
        source: sourceFor(record),
      }
    );
    affectSamples.push({ text: record.body.trim(), weight: 1 });

    for (const mechanicId of extractPitchMechanicIds(record.body)) {
      const category = mechanicId.split('/')[0];
      for (const [axis, share] of MECHANIC_CATEGORY_AXIS_MAP[category] || []) {
        contributions.push({
          axis,
          value: 1,
          weight: PITCH_WEIGHT * share,
          source: sourceFor(record, 'mechanicVocabulary'),
        });
      }
      mechanicReactions.push({
        mechanicId,
        sentiment: 1,
        samples: 1,
        sources: [`pitch:${record.id || 'unknown'}`],
      });
    }
  }

  return { contributions, affectSamples, mechanicReactions };
}

module.exports = { AUTHORSHIP_VALUE, PITCH_WEIGHT, pitchContributions };
