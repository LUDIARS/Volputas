'use strict';

const { renderAuthoritativeJsonFence } = require('./markdownJsonFence');
const { OKF_VERSION } = require('./okfVersion');
const { normalizeSurveyDefinition } = require('./surveyDefinition');
const { renderYamlFrontmatter } = require('./yamlFrontmatter');

function renderSurveyDefinitionOkf(definition) {
  const survey = normalizeSurveyDefinition(definition);
  const authoritativeData = {
    kind: 'voluptas.survey_definition',
    okf_version: OKF_VERSION,
    survey_id: survey.id,
    survey_version: survey.version,
    title: survey.title,
    description: survey.description,
    questions: survey.questions,
  };
  const frontmatter = renderYamlFrontmatter([
    ['type', 'Survey Definition'],
    ['title', survey.title],
    ['description', survey.description],
    ['resource', `urn:voluptas:survey:${encodeURIComponent(survey.id)}:${encodeURIComponent(survey.version)}`],
    // The survey id, not a literal — a fixed 'gamer-preferences' tag mislabels every other
    // survey in the suite and makes the documents unsearchable by what they actually are.
    ['tags', ['voluptas', 'survey', survey.id]],
    ['okf_version', OKF_VERSION],
    ['survey_id', survey.id],
    ['survey_version', survey.version],
  ]);

  return [
    frontmatter,
    '',
    '# Survey definition',
    '',
    'The JSON block below is the authoritative, machine-readable survey definition.',
    '',
    '## Authoritative JSON',
    '',
    renderAuthoritativeJsonFence(authoritativeData),
    '',
  ].join('\n');
}

module.exports = { renderSurveyDefinitionOkf };
