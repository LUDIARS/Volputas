const FALLBACK_CATEGORY = Object.freeze({
  id: 'general',
  label: 'General',
  order: 100,
});

function normalizeCategory(value) {
  if (typeof value === 'string' && value.trim()) {
    return {
      id: value.trim(),
      label: value.trim(),
      order: FALLBACK_CATEGORY.order,
    };
  }
  if (
    value
    && typeof value === 'object'
    && typeof value.id === 'string'
    && value.id.trim()
    && typeof value.label === 'string'
    && value.label.trim()
  ) {
    return {
      id: value.id.trim(),
      label: value.label.trim(),
      order: Number.isInteger(value.order) ? value.order : FALLBACK_CATEGORY.order,
    };
  }
  return FALLBACK_CATEGORY;
}

export function groupSurveysByCategory(surveys) {
  const groups = new Map();
  for (const survey of surveys) {
    const category = normalizeCategory(survey.category);
    const current = groups.get(category.id) || {
      ...category,
      surveys: [],
      answeredCount: 0,
    };
    current.surveys.push(survey);
    if (survey.responseStatus === 'answered') current.answeredCount += 1;
    groups.set(category.id, current);
  }
  return [...groups.values()].sort(
    (left, right) => left.order - right.order || left.label.localeCompare(right.label)
  );
}
