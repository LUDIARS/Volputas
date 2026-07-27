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
const { SURVEY_DEFINITIONS, findSurveyDefinition } = require('../src/surveys/surveyCatalog');

const SURVEY_ID_LIST = SURVEY_DEFINITIONS
  .map((entry) => entry.definition.SURVEY_ID)
  .join(', ');

const USAGE = `Volputas local OKF survey

Usage:
  npm run survey:local
  npm run survey:local -- --survey <survey-id>
  npm run survey:local -- --answers <answers.json>
  npm run survey:local -- --save-only

Options:
  --survey <id>     Survey to answer (default: gamer-preferences).
                    Available: ${SURVEY_ID_LIST}
  --answers <path>  Read a UTF-8 JSON object keyed by question ID.
  --save-only       Compatibility flag; local-only storage is always enforced.
  --help, -h        Show this help.
`;

// An unknown --survey must fail here rather than fall back to the default questionnaire:
// silently answering a different survey than the one asked for would store answers under a
// questionnaire the respondent never saw.
function resolveSurveyDefinition(surveyId) {
  const entry = findSurveyDefinition(surveyId);
  if (!entry) {
    throw new Error(`Unknown survey ID: ${surveyId}. Available: ${SURVEY_ID_LIST}`);
  }
  return entry.definition;
}

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
  resolveSurvey = resolveSurveyDefinition,
  runWorkflow = runLocalSurveyWorkflow,
} = {}) {
  try {
    const options = parseLocalSurveyArguments(argv);
    if (options.help) {
      output.write(USAGE);
      return 0;
    }

    const survey = resolveSurvey(options.surveyId);
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
    output.write(`Survey: ${survey.SURVEY_ID} v${survey.SURVEY_VERSION} (${survey.QUESTIONS.length} questions)\n`);
    const answers = options.answersPath
      ? readAnswers(options.answersPath, { cwd })
      : await collectAnswers(survey.QUESTIONS, { input, output });

    const repositoryRoot = path.resolve(config.serverRoot, '..');
    const producerRevision = runner.run(
      config.gitCommand,
      ['rev-parse', 'HEAD'],
      { cwd: repositoryRoot }
    ).stdout.trim();
    const definition = {
      id: survey.SURVEY_ID,
      version: survey.SURVEY_VERSION,
      title: survey.SURVEY_TITLE,
      description: survey.SURVEY_DESCRIPTION,
      questions: survey.QUESTIONS,
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

module.exports = { resolveSurveyDefinition, USAGE, main };
