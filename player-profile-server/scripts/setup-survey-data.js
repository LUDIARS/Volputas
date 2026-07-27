'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../..');

try {
  execFileSync('git', [
    'submodule',
    'update',
    '--init',
    '--',
    'player-profile-server/private/survey-data',
  ], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });
} catch (error) {
  process.stderr.write(
    '[fatal] Unable to initialize the private Voluptas-Data submodule. ' +
    'Confirm that gh/git can access LUDIARS/Voluptas-Data.\n'
  );
  process.exitCode = error.status || 1;
}
