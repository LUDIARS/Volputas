const config = require('../../config');
const {
  CernereProjectSocketClient,
} = require('./projectSocketClient');
const {
  VoluptasSurveyResponseStore,
} = require('./voluptasSurveyResponseStore');

function createVoluptasSurveyResponseStore() {
  const client = new CernereProjectSocketClient({
    baseUrl: config.cernere.baseUrl,
    clientId: config.cernere.projectClientId,
    clientSecret: config.cernere.projectClientSecret,
  });
  return new VoluptasSurveyResponseStore(client);
}

module.exports = { createVoluptasSurveyResponseStore };
