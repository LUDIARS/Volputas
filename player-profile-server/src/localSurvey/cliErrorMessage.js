'use strict';

// @implements SPEC-LOCAL-SURVEY-GIT-WORKFLOW (Failure contract)
//   spec/interface/local-survey-git-workflow.md
//
// CLI entry points print exactly one `[fatal] …` line. Error messages reaching this
// point can carry a repository URL, a `gh` invocation summary, or a multi-line Git
// failure, so the text is collapsed to a single line and bounded: a CLI must not be
// able to scroll an operator's terminal with raw tool output, and a newline would let
// an attacker-influenced message forge additional log lines.
const MAX_MESSAGE_LENGTH = 500;

function safeErrorMessage(error, fallback = 'Unexpected error') {
  if (!error || typeof error.message !== 'string' || error.message.length === 0) {
    return fallback;
  }
  return error.message.replace(/[\r\n]+/g, ' ').slice(0, MAX_MESSAGE_LENGTH);
}

module.exports = { MAX_MESSAGE_LENGTH, safeErrorMessage };
