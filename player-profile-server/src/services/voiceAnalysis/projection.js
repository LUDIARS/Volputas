const { AXES, CATALOG_REVISION, DIMENSIONS } = require('./catalog');
const VALUE_INDEX = new Map(DIMENSIONS.map((key, index) => [key, index]));
const DIRECTION = { negative: -1, neutral: 0, positive: 1 };

/** @implements SPEC-VOICE-EXPERIENCE-ANALYSIS */
function projectAnalysis({ observations, events, order }) {
  const observed = observations.filter((item) => item.status === 'observed');
  const indices = [...new Set(observed.map((item) => VALUE_INDEX.get(`${item.axisId}:${item.value}`)))].sort((a, b) => a - b);
  const axes = AXES.map((axis) => {
    const items = observations.filter((item) => item.axisId === axis.id);
    const categories = [...new Set(items.filter((item) => item.status === 'observed').map((item) => item.value))];
    return {
      axisId: axis.id, categories, mixed: categories.length > 1,
      states: items.length ? [...new Set(items.map((item) => item.status))] : ['not_mentioned'],
      observationIds: items.map((item) => item.id),
    };
  });
  const byId = new Map(events.map((event) => [event.id, event]));
  // Direct supported transitions only; neither array order nor a transitive
  // path proves continuous time. No interpolation or physical velocity.
  const transitions = order.map((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    return {
      ...edge,
      direction: from.valence === null || to.valence === null ? null
        : Math.sign(DIRECTION[to.valence] - DIRECTION[from.valence]),
    };
  });
  return {
    axes,
    vector: {
      catalogRevision: CATALOG_REVISION, projectionRevision: 'category-presence/1',
      indices, values: indices.map(() => 1),
      observedAxisIds: axes.filter((axis) => axis.categories.length).map((axis) => axis.axisId),
    },
    arc: {
      kind: 'review_reported', coordinate: order.length ? 'ordinal' : 'unknown',
      events, transitions, durationMs: null, changeRate: null,
      limitations: ['retrospective_self_report', 'elapsed_time_unknown', 'intensity_not_measured'],
    },
    coverage: { mentionedAxes: axes.filter((axis) => axis.observationIds.length).length, totalAxes: AXES.length },
  };
}

module.exports = { projectAnalysis };
