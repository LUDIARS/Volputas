const { execFileSync } = require('node:child_process');
const path = require('node:path');

const serverRoot = path.resolve(__dirname, '..');
const packageRoot = path.join(serverRoot, 'lib', 'lapilli', 'packages', 'sentiment-core');

if (!process.argv.includes('--skip-git-update')) {
  execFileSync('git', ['submodule', 'update', '--init', '--recursive'], {
    cwd: path.resolve(serverRoot, '..'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

execFileSync('npm', ['install', '--include=dev', '--package-lock=false'], {
  cwd: packageRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
execFileSync('npm', ['run', 'build'], {
  cwd: packageRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
