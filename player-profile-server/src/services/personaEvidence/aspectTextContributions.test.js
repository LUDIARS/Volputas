const test = require('node:test');
const assert = require('node:assert/strict');
const { aspectTextContributions } = require('./aspectTextContributions');
const { gameplayContributions, voiceContributions } = require('./sourceContributions');
const { surveyAxisContributions } = require('./surveyAxisContributions');

test('positive aspect mentions contribute to mapped axes', () => {
  const { contributions, aversionEvidence } = aspectTextContributions(
    'ストーリーが最高だった',
    { weight: 1.5, source: { kind: 'voice', id: 'v1', field: 'comment' } }
  );
  const narrative = contributions.find((item) => item.axis === 'style.narrative');
  assert.ok(narrative);
  assert.ok(narrative.value > 0);
  assert.equal(narrative.weight, 1.5);
  assert.equal(narrative.note, 'aspect:story');
  assert.deepEqual(aversionEvidence, []);
});

test('negative aspect mentions become aversion evidence, not axis signal', () => {
  const { contributions, aversionEvidence } = aspectTextContributions(
    'ストーリーが薄くてつまらない',
    { weight: 1.5, source: { kind: 'voice', id: 'v1', field: 'comment' } }
  );
  assert.ok(!contributions.some((item) => item.axis === 'style.narrative'));
  const story = aversionEvidence.find((item) => item.target === 'aspect:story');
  assert.ok(story);
  assert.ok(story.strength > 0);
});

test('voice social keyword is polarity-gated by the sentiment slider', () => {
  const positive = voiceContributions({
    id: 'v-pos', sentiment: 2, comment: '友達と協力プレイが楽しい', tags: [],
  });
  assert.ok(positive.contributions.some((item) => item.axis === 'style.socializer'));

  const negative = voiceContributions({
    id: 'v-neg', sentiment: -2, comment: '対戦を強制されるのが苦痛', tags: [],
  });
  assert.ok(!negative.contributions.some((item) => item.axis === 'style.socializer'));
  const aversion = negative.aversionEvidence.find((item) => item.target === 'style.socializer');
  assert.ok(aversion);
  assert.equal(aversion.strength, 1);
});

test('screenshot presence no longer feeds exploration', () => {
  const { contributions } = gameplayContributions({
    id: 'gp-1', screenshotFileName: 'shot.png',
  });
  assert.ok(!contributions.some((item) => item.axis === 'style.explorer'));
});

test('descriptive genre / experience choices map through the §3.7 tables', () => {
  const definition = {
    id: 'gamer-preferences',
    questions: [
      { id: 'favorite-genre', type: 'choice', options: [] },
      { id: 'favorite-experience', type: 'choice', options: [] },
    ],
  };
  const response = {
    survey: { id: 'gamer-preferences' },
    answers: { 'favorite-genre': 'gacha', 'favorite-experience': 'healing' },
  };
  const { contributions } = surveyAxisContributions([response], [definition]);
  assert.deepEqual(
    contributions.map((item) => [item.axis, item.weight]).sort(),
    [
      ['style.collector', 0.6],
      ['style.monetization_sensitivity', 0.4],
      ['style.relaxation', 1],
    ].sort()
  );
});

const { emotionCurveContributions } = require('./sourceContributions');

test('memory-mode emotion curves are discounted by 0.75 for recall bias', () => {
  const base = {
    id: 'ec-1',
    narrativeArc: '転換点',
    entries: [{ valence: 2, arousal: 5, comment: 'よい' }],
  };
  const video = emotionCurveContributions({ ...base, mode: 'video' });
  const memory = emotionCurveContributions({ ...base, mode: 'memory' });
  const weightOf = (result, axis) => result.contributions
    .filter((item) => item.axis === axis)
    .reduce((sum, item) => sum + item.weight, 0);
  assert.ok(Math.abs(weightOf(memory, 'style.narrative') - weightOf(video, 'style.narrative') * 0.75) < 1e-9);
});
