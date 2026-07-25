const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  SurveyDefinitionStore,
  validateSurveyDefinition,
} = require('./surveyDefinitionStore');

test('initializes survey JSON once and then reads it from the data repository', async (t) => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-surveys-'));
  t.after(() => fs.rm(repositoryRoot, { recursive: true, force: true }));
  const store = new SurveyDefinitionStore();

  const created = await store.ensureDefault(repositoryRoot);
  assert.equal(created.action, 'created');
  const preserved = await store.ensureDefault(repositoryRoot);
  assert.equal(preserved.action, 'preserved');

  const surveys = await store.list(repositoryRoot);
  assert.equal(surveys.length, 1);
  assert.equal(surveys[0].id, 'gamer-preference');
  assert.equal(surveys[0].questions.length, 28);
  assert.equal((await store.find(repositoryRoot, 'gamer-preference')).title, surveys[0].title);
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
});
