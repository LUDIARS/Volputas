const config = require('../../config');
const surveyModel = require('../../models/surveyModel');
const { CernereProjectSocketClient } = require('./projectSocketClient');
const { CernereUserResolver } = require('./cernereUserResolver');
const { CernereProfileEvidenceStore } = require('./profileEvidenceStore');

function createProfileEvidenceStore() {
  const projectClient = new CernereProjectSocketClient({
    baseUrl: config.cernere.baseUrl,
    clientId: config.cernere.projectClientId,
    clientSecret: config.cernere.projectClientSecret,
  });
  return new CernereProfileEvidenceStore({
    projectClient,
    userResolver: new CernereUserResolver(),
    surveyModel,
  });
}

let sharedStore;

function getProfileEvidenceStore() {
  if (!sharedStore) sharedStore = createProfileEvidenceStore();
  return sharedStore;
}

function closeProfileEvidenceStore() {
  sharedStore?.close();
  sharedStore = undefined;
}

module.exports = {
  closeProfileEvidenceStore,
  createProfileEvidenceStore,
  getProfileEvidenceStore,
};
