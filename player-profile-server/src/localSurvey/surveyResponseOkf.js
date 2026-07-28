'use strict';

const { normalizeGithubIdentity } = require('./githubIdentity');
const { renderAuthoritativeJsonFence } = require('./markdownJsonFence');
const { OKF_VERSION } = require('./okfVersion');
const { normalizeSurveyDefinition, requireBoundedString } = require('./surveyDefinition');
const { validateSurveyAnswers } = require('./surveyValidator');
const { renderYamlFrontmatter } = require('./yamlFrontmatter');

const REVISION_PATTERN = /^[0-9a-f]{7,64}$/i;

function renderSurveyResponseOkf({
  definition,
  answers,
  identity,
  timestamp,
  producerRevision,
}) {
  const survey = normalizeSurveyDefinition(definition);
  const githubIdentity = normalizeGithubIdentity(identity);
  const submittedAt = normalizeTimestamp(timestamp);
  const revision = normalizeProducerRevision(producerRevision);
  const validatedAnswers = validateSurveyAnswers(answers, survey.questions);
  const definitionPath = `/surveys/${survey.id}.md`;

  const authoritativeData = {
    kind: 'voluptas.survey_response',
    okf_version: OKF_VERSION,
    survey_id: survey.id,
    survey_version: survey.version,
    survey_definition: definitionPath,
    github_identity: githubIdentity,
    submitted_at: submittedAt,
    producer_revision: revision,
    answers: validatedAnswers,
  };
  const frontmatter = renderYamlFrontmatter([
    ['type', 'Survey Response'],
    ['title', `${survey.id} response by ${githubIdentity.login}`],
    ['description', 'Validated survey response keyed to a stable GitHub identity.'],
    [
      'resource',
      [
        'urn:voluptas:survey-response',
        encodeURIComponent(survey.id),
        encodeURIComponent(survey.version),
        'github',
        encodeURIComponent(githubIdentity.id),
      ].join(':'),
    ],
    ['tags', ['voluptas', 'survey-response', 'gamer-preferences']],
    ['timestamp', submittedAt],
    ['okf_version', OKF_VERSION],
    ['survey_id', survey.id],
    ['survey_version', survey.version],
    ['github_user_id', githubIdentity.id],
    ['github_login', githubIdentity.login],
    ['producer_revision', revision],
  ]);

  return [
    frontmatter,
    '',
    '# Survey response',
    '',
    `Validated against the [survey definition](${definitionPath}).`,
    '',
    'The JSON block below is the authoritative response. Human-readable views are derived from it.',
    '',
    '## Authoritative JSON',
    '',
    renderAuthoritativeJsonFence(authoritativeData),
    '',
  ].join('\n');
}

function normalizeTimestamp(timestamp) {
  const value = requireBoundedString(timestamp, 'Survey response timestamp', 100);
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError('Survey response timestamp must include an ISO 8601 time zone');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError('Survey response timestamp must be a valid ISO 8601 timestamp');
  }
  return parsed.toISOString();
}

function normalizeProducerRevision(producerRevision) {
  const value = requireBoundedString(
    producerRevision,
    'Survey response producer revision',
    64
  );
  if (!REVISION_PATTERN.test(value)) {
    throw new TypeError('Survey response producer revision must be a Git commit id');
  }
  return value.toLowerCase();
}

module.exports = { renderSurveyResponseOkf };
