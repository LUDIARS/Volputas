const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const serverRoot = path.resolve(__dirname, '..');
const lapilliRoot = path.join(serverRoot, 'lib', 'lapilli');
const packageRoot = path.join(lapilliRoot, 'packages', 'sentiment-core');
const npmCli = resolveNpmCli();

if (!process.argv.includes('--skip-git-update')) {
  if (fs.existsSync(lapilliRoot) && !fs.existsSync(path.join(packageRoot, 'package.json'))) {
    throw new Error(
      `Lapilli exists but is incomplete at ${lapilliRoot}; refusing to delete it automatically. `
      + 'Move or remove that directory after preserving any local work, then rerun setup.'
    );
  }
  execFileSync('git', [
    'submodule',
    'update',
    '--init',
    '--recursive',
    '--',
    'player-profile-server/lib/lapilli',
  ], {
    cwd: path.resolve(serverRoot, '..'),
    stdio: 'inherit',
  });
}

runNpm(['install', '--include=dev', '--package-lock=false']);
runNpm(['run', 'build']);

function runNpm(argumentsList) {
  execFileSync(process.execPath, [npmCli, ...argumentsList], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
}

function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const npmPath = candidates.find((candidate) => (
    typeof candidate === 'string'
    && path.isAbsolute(candidate)
    && fs.existsSync(candidate)
  ));
  if (!npmPath) {
    throw new Error('Unable to locate npm-cli.js for the Lapilli build');
  }
  return npmPath;
}
