const { version } = require('../../package.json');

const CORPUS_SERVICE_MANIFEST = Object.freeze({
  service: 'voluptas',
  displayName: 'Voluptas',
  version,
  corpusApi: 1,
  health: '/health',
  data: [
    {
      id: 'survey-catalog',
      title: 'Survey catalog',
      path: '/api/v1/integrations/glab/surveys',
      scope: 'multi',
      delegation: { GET: { action: 'survey.list' } },
    },
    {
      id: 'survey-detail',
      title: 'Survey detail',
      path: '/api/v1/integrations/glab/surveys/:id',
      scope: 'multi',
      delegation: { GET: { action: 'survey.read' } },
    },
    {
      id: 'survey-response',
      title: 'Survey response',
      path: '/api/v1/integrations/glab/surveys/:id/response',
      scope: 'multi',
      delegation: { PUT: { action: 'survey.respond' } },
    },
  ],
  panels: [],
  auth: 'cernere-delegated-operation',
  cernereProjectKey: 'voluptas',
});

module.exports = { CORPUS_SERVICE_MANIFEST };
