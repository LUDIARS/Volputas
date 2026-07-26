const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LocalResponseStore, validateAnswers } = require('./localResponseStore');

const survey = {
  id: 'sample',
  title: 'Sample Survey',
  questions: [
    {
      id: 'choice',
      type: 'choice',
      text: 'Choose',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
    },
    { id: 'text', type: 'freetext', text: 'Tell us' },
  ],
};

test('requires complete answers that follow the survey definition', () => {
  assert.deepEqual(validateAnswers(survey, { choice: 'yes', text: 'hello' }), {
    choice: 'yes',
    text: 'hello',
  });
  assert.throws(
    () => validateAnswers(survey, { choice: 'yes' }),
    { code: 'INCOMPLETE_SURVEY_RESPONSE' }
  );
  assert.throws(
    () => validateAnswers(survey, { choice: 'maybe', text: 'hello' }),
    { code: 'INVALID_SURVEY_ANSWER' }
  );
});

test('stores responses below answers/GitHub-name with Git author metadata', async (t) => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-responses-'));
  t.after(() => fs.rm(repositoryRoot, { recursive: true, force: true }));
  const store = new LocalResponseStore(() => new Date('2026-07-25T00:00:00.000Z'));

  const result = await store.write({
    repositoryRoot,
    githubName: 'neco',
    author: {
      name: 'Neco',
      email: 'neco@example.test',
      remoteUrl: 'git@github.com:LUDIARS/Volputas-Data.git',
    },
    survey,
    answers: { choice: 'yes', text: 'hello' },
  });

  assert.equal(
    result.filePath,
    path.join(repositoryRoot, 'answers', 'neco', 'sample.json')
  );
  assert.equal(result.response.respondent.gitAuthor.name, 'Neco');
  assert.equal(
    result.response.dataRepository.remoteUrl,
    'git@github.com:LUDIARS/Volputas-Data.git'
  );
  assert.equal(result.response.updatedAt, '2026-07-25T00:00:00.000Z');
  assert.deepEqual(
    await store.read({ repositoryRoot, githubName: 'neco', surveyId: 'sample' }),
    result.response
  );
});
