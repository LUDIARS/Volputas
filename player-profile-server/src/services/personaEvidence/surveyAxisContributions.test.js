const test = require('node:test');
const assert = require('node:assert/strict');
const { SURVEY_AXIS_WEIGHT, surveyAxisContributions } = require('./surveyAxisContributions');
const { analyzePersonaV2 } = require('./analyzePersonaV2');

const DEFINITION = {
  id: 'gamer-preferences',
  questions: [
    {
      id: 'q_narrative',
      type: 'scale',
      axis: 'style.narrative',
      options: { min: 1, max: 5 },
    },
    {
      id: 'q_routine',
      type: 'choice',
      axis: 'style.routine_tolerance',
      options: [
        { value: 'love', label: '毎日やりたい', weight: 1 },
        { value: 'hate', label: '毎日は無理', weight: 0 },
      ],
    },
    {
      id: 'q_free',
      type: 'text',
      text: '最近心に残った体験は?',
    },
    {
      id: 'q_no_axis',
      type: 'scale',
      options: { min: 1, max: 5 },
    },
  ],
};

const RESPONSE = {
  survey: { id: 'gamer-preferences' },
  answers: {
    q_narrative: 5,
    q_routine: 'hate',
    q_free: '静かな物語で泣いた',
    q_no_axis: 3,
  },
};

test('axis-tagged questions become weight-2 contributions with per-question provenance', () => {
  const { contributions } = surveyAxisContributions([RESPONSE], [DEFINITION]);
  assert.deepEqual(
    contributions.map((item) => [item.axis, item.value, item.weight, item.source.field]),
    [
      ['style.narrative', 1, SURVEY_AXIS_WEIGHT, 'q_narrative'],
      ['style.routine_tolerance', 0, SURVEY_AXIS_WEIGHT, 'q_routine'],
    ]
  );
});

test('strong negative answers on aversion-eligible axes produce aversion evidence', () => {
  const { aversionEvidence } = surveyAxisContributions([RESPONSE], [DEFINITION]);
  assert.deepEqual(aversionEvidence, [{
    target: 'style.routine_tolerance',
    strength: 1,
    source: { kind: 'survey', id: 'gamer-preferences', field: 'q_routine' },
  }]);

  // A strongly *low* answer on a non-eligible axis must not become an aversion.
  const lowNarrative = {
    survey: { id: 'gamer-preferences' },
    answers: { q_narrative: 1 },
  };
  const result = surveyAxisContributions([lowNarrative], [DEFINITION]);
  assert.deepEqual(result.aversionEvidence, []);
});

test('responses without a matching definition contribute nothing', () => {
  const orphan = { survey: { id: 'unknown-survey' }, answers: { q_narrative: 5 } };
  const { contributions, aversionEvidence } = surveyAxisContributions([orphan], [DEFINITION]);
  assert.deepEqual(contributions, []);
  assert.deepEqual(aversionEvidence, []);
});

test('analyzePersonaV2 wires survey metadata into axes, aversions, and affect', () => {
  const sources = {
    surveys: [RESPONSE],
    surveyDefinitions: [DEFINITION],
    gameplay: [],
    voices: [],
    emotionCurves: [],
  };
  const analysis = analyzePersonaV2(sources, '2026-07-28T15:00:00.000Z');

  const narrative = analysis.preferenceAxes['style.narrative'];
  assert.equal(narrative.evidenceWeight >= SURVEY_AXIS_WEIGHT, true);
  assert.ok(narrative.contributions.some((item) => item.source.field === 'q_narrative'));

  // The strongly negative routine answer becomes an aversion; the free text
  // (「泣いた」を含む負極性の文で story に言及) additionally yields an
  // aspect:story aversion via the T4 text analysis.
  const routineAversion = analysis.aversions.find((item) => item.target === 'style.routine_tolerance');
  assert.ok(routineAversion);
  assert.match(routineAversion.sources[0], /survey:gamer-preferences#q_routine/);

  // Freetext answers reach the shared 20D affect vector.
  assert.ok(analysis.affect);
  assert.equal(analysis.affect.sampleTexts, 1);
  assert.equal(analysis.affect.vector.length, 20);

  assert.equal(analysis.evidence.surveyDefinitions, 1);
});

test('analyzePersonaV2 stays functional without definitions', () => {
  const sources = {
    surveys: [RESPONSE],
    gameplay: [],
    voices: [],
    emotionCurves: [],
  };
  const analysis = analyzePersonaV2(sources, '2026-07-28T15:00:00.000Z');
  // Definition-dependent outputs are absent…
  assert.equal(analysis.affect, null);
  const narrative = analysis.preferenceAxes['style.narrative'];
  assert.ok(!narrative.contributions.some((item) => item.source.field === 'q_narrative'));
  assert.equal(analysis.preferenceAxes['style.routine_tolerance'].score, null);
  assert.ok(!analysis.aversions.some((item) => item.target === 'style.routine_tolerance'));
  // …but raw answer text still runs through the aspect analysis.
  assert.ok(analysis.aversions.every((item) => item.target.startsWith('aspect:')));
});
