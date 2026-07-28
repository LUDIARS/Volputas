const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { GitCli } = require('./gitCli');
const { GitSurveyPublisher, responsePathspec } = require('./gitSurveyPublisher');

const execFileAsync = promisify(execFile);

async function git(args) {
  return execFileAsync('git', args, { encoding: 'utf8', windowsHide: true });
}

test('publishes only the survey response and preserves unrelated staged changes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-publish-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repositoryRoot = path.join(root, 'VolputasData');
  const remoteRoot = path.join(root, 'remote.git');
  await git(['init', '--bare', remoteRoot]);
  await git(['init', repositoryRoot]);
  await git(['-C', repositoryRoot, 'checkout', '-b', 'main']);
  await git(['-C', repositoryRoot, 'config', 'user.name', 'Neco']);
  await git(['-C', repositoryRoot, 'config', 'user.email', 'neco@example.test']);
  await fs.writeFile(path.join(repositoryRoot, 'README.md'), '# VolputasData\n', 'utf8');
  await git(['-C', repositoryRoot, 'add', 'README.md']);
  await git(['-C', repositoryRoot, 'commit', '-m', 'Initial data repository']);
  await git(['-C', repositoryRoot, 'remote', 'add', 'origin', remoteRoot]);
  await git(['-C', repositoryRoot, 'push', '-u', 'origin', 'main']);

  await fs.writeFile(path.join(repositoryRoot, 'unrelated.json'), '{}\n', 'utf8');
  await git(['-C', repositoryRoot, 'add', 'unrelated.json']);
  const responseFilePath = path.join(
    repositoryRoot,
    'answers',
    'Neco',
    'public-gamer-profile.json'
  );
  await fs.mkdir(path.dirname(responseFilePath), { recursive: true });
  await fs.writeFile(responseFilePath, '{"schemaVersion":2}\n', 'utf8');

  const result = await new GitSurveyPublisher(new GitCli()).publish({
    repositoryRoot,
    responseFilePath,
    surveyId: 'public-gamer-profile',
  });

  assert.equal(result.committed, true);
  assert.equal(result.pushed, true);
  assert.equal(result.pathspec, 'answers/Neco/public-gamer-profile.json');
  const committedFiles = await git([
    '-C',
    repositoryRoot,
    'show',
    '--name-only',
    '--format=',
    'HEAD',
  ]);
  assert.equal(committedFiles.stdout.trim(), 'answers/Neco/public-gamer-profile.json');
  const status = await git(['-C', repositoryRoot, 'status', '--short']);
  assert.match(status.stdout, /^A  unrelated\.json/m);
  const localRevision = await git(['-C', repositoryRoot, 'rev-parse', 'HEAD']);
  const remoteRevision = await git(['--git-dir', remoteRoot, 'rev-parse', 'refs/heads/main']);
  assert.equal(localRevision.stdout.trim(), remoteRevision.stdout.trim());
});

test('serializes publish operations and reports push failures without exposing command output', async () => {
  const calls = [];
  let active = 0;
  let maximumActive = 0;
  const gitCli = {
    async execute(args) {
      calls.push(args);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (args.includes('push')) throw new Error('remote included a sensitive credential');
      if (args.includes('status')) return { stdout: 'M  answers/Neco/sample.json\n' };
      if (args.includes('rev-parse')) return { stdout: 'abc1234\n' };
      return { stdout: '' };
    },
  };
  const publisher = new GitSurveyPublisher(gitCli);
  const input = {
    repositoryRoot: path.resolve('VolputasData'),
    responseFilePath: path.resolve('VolputasData/answers/Neco/sample.json'),
    surveyId: 'sample',
  };

  const results = await Promise.allSettled([publisher.publish(input), publisher.publish(input)]);

  assert.equal(maximumActive, 1);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[0].reason.code, 'GIT_SYNC_FAILED');
  assert.equal(results[0].reason.phase, 'push');
  assert.doesNotMatch(results[0].reason.message, /sensitive credential/);
  assert.equal(results[1].status, 'rejected');
  assert.equal(calls.filter((args) => args.includes('push')).length, 2);
});

test('rejects files outside answers in the configured repository', () => {
  const repositoryRoot = path.resolve('VolputasData');
  assert.throws(
    () => responsePathspec(repositoryRoot, path.resolve('other-repository/answers/sample.json')),
    { code: 'INVALID_RESPONSE_PATH' }
  );
  assert.throws(
    () => responsePathspec(repositoryRoot, path.join(repositoryRoot, 'surveys/sample.json')),
    { code: 'INVALID_RESPONSE_PATH' }
  );
});
