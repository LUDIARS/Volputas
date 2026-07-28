const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  SurveyDefinitionStore,
  validateSurveyDefinition,
} = require('./surveyDefinitionStore');

function surveyFixture(id, overrides = {}) {
  return {
    id,
    category: { id: 'player-profile', label: 'プレイヤープロフィール', order: 10 },
    title: `${id} title`,
    description: `${id} description`,
    questions: [{ id: 'q1', type: 'freetext', text: 'Question' }],
    ...overrides,
  };
}

async function writeSurveys(repositoryRoot, surveys) {
  const directory = path.join(repositoryRoot, 'surveys');
  await fs.mkdir(directory, { recursive: true });
  for (const survey of surveys) {
    await fs.writeFile(
      path.join(directory, `${survey.id}.json`),
      `${JSON.stringify(survey, null, 2)}\n`,
      'utf8'
    );
  }
}

test('reads every survey definition from the data repository', async (t) => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-surveys-'));
  t.after(() => fs.rm(repositoryRoot, { recursive: true, force: true }));
  const store = new SurveyDefinitionStore();

  await writeSurveys(repositoryRoot, [
    surveyFixture('gamer-preference'),
    surveyFixture('gamer-subtypes'),
    surveyFixture('gamer-emotions'),
  ]);

  const surveys = await store.list(repositoryRoot);
  // ファイル名順。データリポジトリへ足すだけで一覧に出ることを保証する。
  assert.deepEqual(surveys.map((survey) => survey.id), [
    'gamer-emotions',
    'gamer-preference',
    'gamer-subtypes',
  ]);
  assert.deepEqual(surveys[0].category, {
    id: 'player-profile',
    label: 'プレイヤープロフィール',
    order: 10,
  });
  assert.equal((await store.find(repositoryRoot, 'gamer-subtypes')).title, 'gamer-subtypes title');
  assert.equal(await store.find(repositoryRoot, 'not-present'), null);
});

test('an empty or missing survey directory fails instead of seeding a bundled default', async (t) => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-surveys-empty-'));
  t.after(() => fs.rm(repositoryRoot, { recursive: true, force: true }));
  const store = new SurveyDefinitionStore();

  await assert.rejects(() => store.list(repositoryRoot), { code: 'SURVEY_DATA_MISSING' });

  await fs.mkdir(path.join(repositoryRoot, 'surveys'), { recursive: true });
  await assert.rejects(() => store.list(repositoryRoot), { code: 'SURVEY_DATA_MISSING' });
});

test('a survey whose filename does not match its id is rejected', async (t) => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-surveys-mismatch-'));
  t.after(() => fs.rm(repositoryRoot, { recursive: true, force: true }));
  const store = new SurveyDefinitionStore();

  const directory = path.join(repositoryRoot, 'surveys');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'renamed.json'),
    `${JSON.stringify(surveyFixture('gamer-preference'), null, 2)}\n`,
    'utf8'
  );

  await assert.rejects(() => store.list(repositoryRoot), { code: 'INVALID_SURVEY_DEFINITION' });
});

test('rejects malformed or duplicate-question survey definitions', () => {
  assert.throws(
    () => validateSurveyDefinition({
      id: 'bad survey id',
      title: 'Bad',
      questions: [{ id: 'q', type: 'freetext', text: 'Question' }],
    }),
    { code: 'INVALID_SURVEY_DEFINITION' }
  );
  assert.throws(
    () => validateSurveyDefinition({
      id: 'duplicate',
      title: 'Duplicate',
      questions: [
        { id: 'q', type: 'freetext', text: 'One' },
        { id: 'q', type: 'freetext', text: 'Two' },
      ],
    }),
    { code: 'INVALID_SURVEY_DEFINITION' }
  );
  assert.throws(
    () => validateSurveyDefinition({
      id: 'bad-choice',
      title: 'Bad choice',
      questions: [{ id: 'q', type: 'choice', text: 'Choose', options: [{}] }],
    }),
    { code: 'INVALID_SURVEY_DEFINITION' }
  );
  assert.throws(
    () => validateSurveyDefinition({
      id: 'bad-category',
      title: 'Bad category',
      category: { id: 'not valid', label: '', order: 1.5 },
      questions: [{ id: 'q', type: 'freetext', text: 'Question' }],
    }),
    { code: 'INVALID_SURVEY_DEFINITION' }
  );
});
