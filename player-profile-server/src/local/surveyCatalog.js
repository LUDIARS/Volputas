const {
  SURVEY_TITLE,
  SURVEY_DESCRIPTION,
  QUESTIONS,
} = require('../../scripts/data/gamer-survey-questions');

const GAMER_SURVEY_ID = 'gamer-preference';
const GAMER_SURVEY = Object.freeze({
  id: GAMER_SURVEY_ID,
  title: SURVEY_TITLE,
  description: SURVEY_DESCRIPTION,
  category: {
    id: 'player-profile',
    label: 'プレイヤープロフィール',
    order: 10,
  },
  questions: QUESTIONS,
});

function listSurveys() {
  return [GAMER_SURVEY];
}

function findSurvey(surveyId) {
  return surveyId === GAMER_SURVEY_ID ? GAMER_SURVEY : null;
}

module.exports = {
  GAMER_SURVEY,
  GAMER_SURVEY_ID,
  findSurvey,
  listSurveys,
};
