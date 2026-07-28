const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyFromSurveyRecords } = require('./classificationEngine');
const { analyzePersonaV2 } = require('./personaEvidence/analyzePersonaV2');

const RECORDS = [{
  questions: [
    { id: 'q_power', type: 'scale', dimension: 'power_fantasy', options: { min: 1, max: 5 } },
    { id: 'q_win', type: 'scale', dimension: 'winning', options: { min: 1, max: 5 } },
    { id: 'q_luck', type: 'choice', dimension: 'luck_chance', scoring: { yes: 1, no: -1 } },
    { id: 'q_routine', type: 'scale', dimension: 'daily_routine', options: { min: 1, max: 5 } },
  ],
  answers: { q_power: 5, q_win: 2, q_luck: 'yes', q_routine: 4 },
}];

test('classifyFromSurveyRecords scores all three pattern families from metadata', () => {
  const result = classifyFromSurveyRecords(RECORDS);
  assert.ok(result);
  assert.equal(result.classification.gamer.primary, 'timmy');
  assert.equal(result.classification.gamer.scores.timmy, 1);
  assert.equal(result.classification.mechanics.primary, 'alea');
  assert.equal(result.classification.story.primary, 'banal');
  assert.ok(result.tags.includes('gamer:timmy'));
  assert.equal(result.vector.length, 12);
});

test('classifyFromSurveyRecords returns null without dimension-tagged answers', () => {
  assert.equal(classifyFromSurveyRecords([]), null);
  assert.equal(classifyFromSurveyRecords([{
    questions: [{ id: 'q', type: 'scale', axis: 'style.mastery', options: { min: 1, max: 5 } }],
    answers: { q: 3 },
  }]), null);
});

test('analyzePersonaV2 merges the 12-classification compartment', () => {
  const definition = { id: 's1', questions: RECORDS[0].questions };
  const response = { survey: { id: 's1' }, answers: RECORDS[0].answers };
  const analysis = analyzePersonaV2({
    surveys: [response],
    surveyDefinitions: [definition],
    gameplay: [],
    voices: [],
    emotionCurves: [],
  }, '2026-07-28T16:00:00.000Z');

  assert.equal(analysis.classification.gamer.primary, 'timmy');
  assert.ok(analysis.classification.tags.includes('gamer:timmy'));
  assert.equal(analysis.classification.dimensionVector.length, 12);

  const withoutDefinitions = analyzePersonaV2({
    surveys: [response],
    gameplay: [],
    voices: [],
    emotionCurves: [],
  }, '2026-07-28T16:00:00.000Z');
  assert.equal(withoutDefinitions.classification, null);
});
