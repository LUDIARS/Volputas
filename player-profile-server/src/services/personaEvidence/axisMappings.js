// Single home for deterministic vocabulary → axis mappings (design §3.7).
// Every map value is [[axis, share], ...]; shares split the caller's weight.
// Keep these in sync with the survey option vocabularies
// (src/surveys/gamerPreferencesSurvey.js) and sentiment-core ASP_KEYS.

// favorite-genre answer values.
const GENRE_AXIS_MAP = Object.freeze({
  roguelike: [['style.mastery', 0.6], ['style.routine_tolerance', 0.4]],
  gacha: [['style.collector', 0.6], ['style.monetization_sensitivity', 0.4]],
  fps: [['style.competitor', 1]],
  rpg: [['style.narrative', 0.6], ['style.explorer', 0.4]],
  puzzle: [['style.mastery', 1]],
  action: [['style.competitor', 0.5], ['style.mastery', 0.5]],
  strategy: [['style.mastery', 0.6], ['style.autonomy', 0.4]],
  horror: [['style.narrative', 0.5], ['style.explorer', 0.5]],
  simulation: [['style.autonomy', 0.6], ['style.collector', 0.4]],
  fighting: [['style.competitor', 1]],
});

// favorite-experience (emotionSeeks) answer values.
const EXPERIENCE_AXIS_MAP = Object.freeze({
  excitement: [['mtg.timmy', 1]],
  tension: [['style.competitor', 0.6], ['style.mastery', 0.4]],
  achievement: [['style.achiever', 1]],
  healing: [['style.relaxation', 1]],
  immersion: [['style.narrative', 1]],
  social: [['style.socializer', 1]],
  collection: [['style.collector', 1]],
  growth: [['style.mastery', 1]],
});

// Question id → answer-value map for axis-less descriptive choice questions.
const SURVEY_CHOICE_AXIS_QUESTIONS = Object.freeze({
  'favorite-genre': GENRE_AXIS_MAP,
  'favorite-experience': EXPERIENCE_AXIS_MAP,
});

// Steam storefront genre labels (lowercased) → axes. Used with the
// steam_app_meta cache (design §3.2.1); labels without a stable preference
// reading (indie, free to play, early access, casual) are deliberately absent.
const STEAM_GENRE_AXIS_MAP = Object.freeze({
  rpg: [['style.narrative', 0.6], ['style.explorer', 0.4]],
  adventure: [['style.explorer', 1]],
  action: [['style.competitor', 0.5], ['style.mastery', 0.5]],
  strategy: [['style.mastery', 0.6], ['style.autonomy', 0.4]],
  simulation: [['style.autonomy', 0.6], ['style.collector', 0.4]],
  sports: [['style.competitor', 1]],
  racing: [['style.competitor', 0.6], ['style.mastery', 0.4]],
  'massively multiplayer': [['style.socializer', 1]],
  puzzle: [['style.mastery', 1]],
});

// sentiment-core aspect key → axes. Only aspects with an unambiguous axis
// reading are mapped; fun/content/performance/graphics carry no stable
// preference-axis meaning on their own.
const ASPECT_AXIS_MAP = Object.freeze({
  story: [['style.narrative', 1]],
  difficulty: [['style.mastery', 0.5], ['style.competitor', 0.5]],
  replayability: [['style.routine_tolerance', 1]],
  price_value: [['style.monetization_sensitivity', 1]],
});

function mapChoiceToContributions(map, answer, { weight, source }) {
  const targets = map[String(answer)];
  if (!targets) return [];
  return targets.map(([axis, share]) => ({
    axis,
    value: 1,
    weight: weight * share,
    source,
  }));
}

module.exports = {
  ASPECT_AXIS_MAP,
  EXPERIENCE_AXIS_MAP,
  GENRE_AXIS_MAP,
  STEAM_GENRE_AXIS_MAP,
  SURVEY_CHOICE_AXIS_QUESTIONS,
  mapChoiceToContributions,
};
