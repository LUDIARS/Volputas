const config = require('../../config');
const {
  CernereProjectSocketClient,
} = require('./projectSocketClient');
const {
  VolputasSurveyResponseStore,
} = require('./volputasSurveyResponseStore');

function createVolputasSurveyResponseStore() {
  const client = new CernereProjectSocketClient({
    baseUrl: config.cernere.baseUrl,
    clientId: config.cernere.projectClientId,
    clientSecret: config.cernere.projectClientSecret,
  });
  return new VolputasSurveyResponseStore(client);
}

module.exports = { createVolputasSurveyResponseStore };
