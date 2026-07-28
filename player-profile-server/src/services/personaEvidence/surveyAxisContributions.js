// Survey question metadata wiring (design §3.1 / T2): axis-tagged questions
// contribute their scored answer directly to the canonical 15 axes as
// self-reported evidence (heaviest weight class), and strongly negative
// answers on aversion-eligible axes double as aversion evidence.
const { PREFERENCE_AXES } = require('../preferenceAxisDefinitions');
const { scoreQuestion } = require('../preferenceAxes');
const { SURVEY_CHOICE_AXIS_QUESTIONS, mapChoiceToContributions } = require('./axisMappings');

const AXIS_SET = new Set(PREFERENCE_AXES);
const SURVEY_AXIS_WEIGHT = 2;
// 「強い否定側」回答を忌避として扱う軸 (design §3.1)。低スコア=志向が弱いだけの
// 軸 (mastery 等) を巻き込まないよう、忌避解釈が成立する軸に限定する。
const AVERSION_SURVEY_AXES = new Set([
  'style.routine_tolerance',
  'style.monetization_sensitivity',
]);
const AVERSION_SCORE_THRESHOLD = 0.25;

function definitionIndex(definitions) {
  return new Map((definitions || [])
    .filter((definition) => definition && definition.id)
    .map((definition) => [definition.id, definition]));
}

// Returns { contributions, aversionEvidence } — the latter feeds the
// top-level aversions compartment, separate from axis scores.
function surveyAxisContributions(responses, definitions) {
  const byId = definitionIndex(definitions);
  const contributions = [];
  const aversionEvidence = [];
  for (const response of responses || []) {
    const surveyId = response.survey?.id || response.surveyId || null;
    const definition = surveyId ? byId.get(surveyId) : null;
    if (!definition || !Array.isArray(definition.questions)) continue;
    if (!response.answers || typeof response.answers !== 'object') continue;
    for (const question of definition.questions) {
      const answer = response.answers[question.id];
      if (answer === undefined || answer === null) continue;

      // Axis-less descriptive choices (genre / emotionSeeks) map through the
      // §3.7 vocabulary tables at weight 1.
      const choiceMap = SURVEY_CHOICE_AXIS_QUESTIONS[question.id];
      if (!AXIS_SET.has(question.axis)) {
        if (choiceMap) {
          contributions.push(...mapChoiceToContributions(choiceMap, answer, {
            weight: 1,
            source: { kind: 'survey', id: surveyId, field: question.id },
          }));
        }
        continue;
      }
      const score = scoreQuestion(question, answer);
      if (score === null) continue;
      const source = { kind: 'survey', id: surveyId, field: question.id };
      contributions.push({
        axis: question.axis,
        value: score,
        weight: SURVEY_AXIS_WEIGHT,
        source,
      });
      if (AVERSION_SURVEY_AXES.has(question.axis) && score <= AVERSION_SCORE_THRESHOLD) {
        aversionEvidence.push({
          target: question.axis,
          strength: Number((1 - score).toFixed(4)),
          source,
        });
      }
    }
  }
  return { contributions, aversionEvidence };
}

module.exports = {
  AVERSION_SCORE_THRESHOLD,
  AVERSION_SURVEY_AXES,
  SURVEY_AXIS_WEIGHT,
  surveyAxisContributions,
};
