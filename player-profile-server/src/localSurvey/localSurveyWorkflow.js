'use strict';

const { createGitSurveyPublisher } = require('./gitSurveyPublisher');
const { createRepositoryLock } = require('./repositoryLock');
const { renderSurveyDefinitionOkf } = require('./surveyDefinitionOkf');
const { renderSurveyResponseOkf } = require('./surveyResponseOkf');
const { surveyArtifactPaths, writeSurveyArtifacts } = require('./surveyDataStore');
const { validateSurveyAnswers } = require('./surveyValidator');

async function runLocalSurveyWorkflow({
  answers,
  config,
  definition,
  identity,
  producerRevision,
  saveOnly,
  timestamp,
}, {
  publisherFactory = createGitSurveyPublisher,
  lockFactory = createRepositoryLock,
  renderDefinition = renderSurveyDefinitionOkf,
  renderResponse = renderSurveyResponseOkf,
  writeArtifacts = writeSurveyArtifacts,
  validateAnswers = validateSurveyAnswers,
  runner,
} = {}) {
  if (saveOnly !== true) {
    throw new Error(
      'Remote publication is disabled for the public VolputasData repository'
    );
  }
  const validatedAnswers = validateAnswers(answers, definition.questions);
  const paths = surveyArtifactPaths({
    surveyId: definition.id,
    identityId: identity.id,
  });
  const allowedPaths = [paths.definition, paths.response];
  const definitionDocument = renderDefinition(definition);
  const responseDocument = renderResponse({
    definition,
    answers: validatedAnswers,
    identity,
    timestamp,
    producerRevision,
  });

  const publisher = publisherFactory({
    dataRepositoryRoot: config.dataRepositoryRoot,
    expectedRemoteUrl: config.expectedRemoteUrl,
    remoteName: config.remote,
    baseBranch: config.baseBranch,
    branchPrefix: config.responseBranchPrefix,
    gitCommand: config.gitCommand,
    allowRemotePublish: config.allowRemotePublish,
  }, { runner });
  const lock = lockFactory({
    repositoryRoot: config.dataRepositoryRoot,
    runner,
    gitCommand: config.gitCommand,
  });

  return lock.runExclusive(async () => {
    const preparation = await publisher.prepare(identity, {
      offline: true,
      allowedPaths,
    });
    const artifacts = writeArtifacts({
      root: config.dataRepositoryRoot,
      surveyId: definition.id,
      identity,
      definitionDocument,
      responseDocument,
    });

    return Object.freeze({
      status: 'saved',
      branch: preparation.branch,
      relativePaths: artifacts.relativePaths,
    });
  });
}

module.exports = { runLocalSurveyWorkflow };
