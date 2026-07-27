'use strict';

const path = require('node:path');
const { readAnswersFile } = require('../src/localSurvey/answerFile');
const { parseLocalSurveyArguments } = require('../src/localSurvey/cliArguments');
const { assertPublicGithubRepository } = require(
  '../src/localSurvey/githubRepositoryVisibility'
);
const { resolveGithubIdentity } = require('../src/localSurvey/githubIdentity');
const { collectInteractiveAnswers } = require('../src/localSurvey/interactiveSurvey');
const { loadLocalSurveyConfig } = require('../src/localSurvey/localSurveyConfig');
const { runLocalSurveyWorkflow } = require('../src/localSurvey/localSurveyWorkflow');
const { createProcessRunner } = require('../src/localSurvey/processRunner');
const {
  SURVEY_ID,
  SURVEY_VERSION,
  SURVEY_TITLE,
  SURVEY_DESCRIPTION,
  QUESTIONS,
} = require('./data/gamer-survey-questions');

const USAGE = `Volputas local OKF survey

Usage:
  npm run survey:local
  npm run survey:local -- --answers <answers.json>
  npm run survey:local -- --save-only

Options:
  --answers <path>  Read a UTF-8 JSON object keyed by question ID.
  --save-only       Compatibility flag; local-only storage is always enforced.
  --help, -h        Show this help.
`;

async function main({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  input = process.stdin,
  output = process.stdout,
  errorOutput = process.stderr,
  now = () => new Date(),
} = {}, {
  assertPublicRepository = assertPublicGithubRepository,
  collectAnswers = collectInteractiveAnswers,
  createRunner = createProcessRunner,
  loadConfig = loadLocalSurveyConfig,
  readAnswers = readAnswersFile,
  resolveIdentity = resolveGithubIdentity,
  runWorkflow = runLocalSurveyWorkflow,
} = {}) {
  try {
    const options = parseLocalSurveyArguments(argv);
    if (options.help) {
      output.write(USAGE);
      return 0;
    }

    const config = loadConfig({ env });
    const runner = createRunner();
    const identity = resolveIdentity({
      cwd: config.serverRoot,
      runner,
      githubCommand: config.githubCommand,
    });
    assertPublicRepository({
      cwd: config.serverRoot,
      repository: config.githubRepository,
      githubCommand: config.githubCommand,
      runner,
    });

    output.write(`GitHub identity: @${identity.login} (${identity.id})\n`);
    const answers = options.answersPath
      ? readAnswers(options.answersPath, { cwd })
      : await collectAnswers(QUESTIONS, { input, output });

    const repositoryRoot = path.resolve(config.serverRoot, '..');
    const producerRevision = runner.run(
      config.gitCommand,
      ['rev-parse', 'HEAD'],
      { cwd: repositoryRoot }
    ).stdout.trim();
    const definition = {
      id: SURVEY_ID,
      version: SURVEY_VERSION,
      title: SURVEY_TITLE,
      description: SURVEY_DESCRIPTION,
      questions: QUESTIONS,
    };
    const result = await runWorkflow({
      answers,
      config,
      definition,
      identity,
      producerRevision,
      saveOnly: options.saveOnly,
      timestamp: now().toISOString(),
    }, { runner });

    for (const relativePath of result.relativePaths) {
      output.write(`Saved: ${relativePath}\n`);
    }
    if (result.status === 'published') {
      output.write(
        `Published: ${result.branch} (${result.change}, ${result.commitSha})\n`
      );
    } else {
      output.write(`Local branch: ${result.branch} (not published)\n`);
    }
    return 0;
  } catch (error) {
    errorOutput.write(`[fatal] Local survey failed: ${safeErrorMessage(error)}\n`);
    return 1;
  }
}

function safeErrorMessage(error) {
  if (!error || typeof error.message !== 'string' || error.message.length === 0) {
    return 'Unexpected error';
  }
  return error.message.replace(/[\r\n]+/g, ' ').slice(0, 500);
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = { USAGE, main };
