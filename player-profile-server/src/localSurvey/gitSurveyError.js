'use strict';

class GitSurveyPublisherError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GitSurveyPublisherError';
    this.code = code;
  }
}

module.exports = { GitSurveyPublisherError };
