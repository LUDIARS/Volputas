const test = require('node:test');
const assert = require('node:assert/strict');
const {
  UPDATE_REPOSITORY,
  startAutoUpdates,
} = require('./autoUpdate');

test('starts public GitHub release updates only for packaged supported platforms', () => {
  let receivedOptions;
  let stopped = false;
  const stop = startAutoUpdates({
    isPackaged: true,
    platform: 'win32',
    updateSourceType: { ElectronPublicUpdateService: 'public' },
    updater: (options) => {
      receivedOptions = options;
      return { stopUpdates: () => { stopped = true; } };
    },
    logger: {},
  });

  assert.equal(receivedOptions.updateSource.repo, UPDATE_REPOSITORY);
  assert.equal(receivedOptions.updateSource.type, 'public');
  assert.equal(receivedOptions.notifyUser, true);
  stop();
  assert.equal(stopped, true);
});

test('does not contact the updater in development or on Linux', () => {
  let calls = 0;
  const updater = () => {
    calls += 1;
    return { stopUpdates() {} };
  };

  startAutoUpdates({ isPackaged: false, platform: 'win32', updater });
  startAutoUpdates({ isPackaged: true, platform: 'linux', updater });
  assert.equal(calls, 0);
});
