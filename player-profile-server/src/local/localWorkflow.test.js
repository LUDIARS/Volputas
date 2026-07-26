const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { LocalConfigStore } = require('./localConfigStore');
const { GitAuthorReader } = require('./gitAuthorReader');
const { LocalResponseStore } = require('./localResponseStore');
const { SurveyDefinitionStore } = require('./surveyDefinitionStore');

const execFileAsync = promisify(execFile);

function sampleAnswer(question) {
  if (question.type === 'choice') {
    const option = question.options[0];
    return typeof option === 'object' ? option.value : option;
  }
  if (question.type === 'scale') return question.options?.min ?? 1;
  return 'sample answer';
}

test('local workflow initializes repository survey JSON and writes a Git-attributed response', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-workflow-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repositoryPath = path.join(root, 'Volputas-Data');
  await fs.mkdir(repositoryPath);
  await execFileAsync('git', ['init', repositoryPath], { windowsHide: true });
  await execFileAsync('git', ['-C', repositoryPath, 'config', 'user.name', 'Neco'], {
    windowsHide: true,
  });
  await execFileAsync(
    'git',
    ['-C', repositoryPath, 'config', 'user.email', 'neco@example.test'],
    { windowsHide: true }
  );
  await execFileAsync(
    'git',
    ['-C', repositoryPath, 'remote', 'add', 'origin', 'git@github.com:neco/Volputas-Data.git'],
    { windowsHide: true }
  );

  const configStore = new LocalConfigStore(path.join(root, 'config.json'));
  const config = await configStore.write({
    dataRepositoryPath: repositoryPath,
    name: 'neco',
  });
  const author = await new GitAuthorReader().read(config.dataRepositoryPath);
  const surveyStore = new SurveyDefinitionStore();
  await surveyStore.ensureDefault(author.repositoryRoot);
  const [survey] = await surveyStore.list(author.repositoryRoot);
  const answers = Object.fromEntries(
    survey.questions.map((question) => [question.id, sampleAnswer(question)])
  );
  const responseStore = new LocalResponseStore(
    () => new Date('2026-07-25T00:00:00.000Z')
  );
  const result = await responseStore.write({
    repositoryRoot: author.repositoryRoot,
    name: config.name,
    author,
    survey,
    answers,
  });

  assert.equal(survey.questions.length, 28);
  assert.equal(
    result.filePath,
    path.join(repositoryPath, 'answers', 'neco', 'gamer-preference.json')
  );
  assert.equal(result.response.respondent.gitAuthor.name, 'Neco');
  assert.equal(result.response.dataRepository.remoteUrl, 'git@github.com:neco/Volputas-Data.git');
});
