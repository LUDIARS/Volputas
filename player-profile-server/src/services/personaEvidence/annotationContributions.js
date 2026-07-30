// Screenshot annotation evidence (design §4.3). Only the user's explicit
// moment type and caption are interpreted; image bytes never enter analysis.
const { MOMENT_TYPE_AXIS_MAP } = require('./axisMappings');

const ANNOTATION_WEIGHT = 1;

function annotationContributions(records) {
  const contributions = [];
  const affectSamples = [];

  for (const record of records || []) {
    const source = {
      kind: 'annotation',
      id: record.id || 'unknown',
      field: 'momentType',
    };
    for (const [axis, share] of MOMENT_TYPE_AXIS_MAP[record.momentType] || []) {
      contributions.push({
        axis,
        value: 1,
        weight: ANNOTATION_WEIGHT * share,
        source,
      });
    }
    if (typeof record.caption === 'string' && record.caption.trim()) {
      affectSamples.push({ text: record.caption.trim(), weight: 1 });
    }
  }

  return { contributions, affectSamples };
}

module.exports = { ANNOTATION_WEIGHT, annotationContributions };
