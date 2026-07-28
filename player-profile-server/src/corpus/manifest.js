const { version } = require('../../package.json');

const CORPUS_SERVICE_MANIFEST = Object.freeze({
  service: 'volputas',
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
    },
    {
      id: 'survey-detail',
      title: 'Survey detail',
      path: '/api/v1/integrations/glab/surveys/:id',
      scope: 'multi',
    },
    {
      id: 'survey-response',
      title: 'Survey response',
      path: '/api/v1/integrations/glab/surveys/:id/response',
      scope: 'multi',
    },
  ],
  panels: [],
  auth: 'cernere-project-token',
  cernereProjectKey: 'volputas',
});

module.exports = { CORPUS_SERVICE_MANIFEST };
