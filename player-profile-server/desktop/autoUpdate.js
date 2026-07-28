const UPDATE_REPOSITORY = 'LUDIARS/Voluptas';
const SUPPORTED_PLATFORMS = new Set(['darwin', 'win32']);

function createStderrLogger() {
  function write(level, message) {
    process.stderr.write(`[auto-update:${level}] ${String(message)}\n`);
  }
  return {
    log: (message) => write('log', message),
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
  };
}

function startAutoUpdates({
  isPackaged,
  platform = process.platform,
  updater,
  updateSourceType,
  logger = createStderrLogger(),
}) {
  if (!isPackaged || !SUPPORTED_PLATFORMS.has(platform)) return () => {};

  const updaterModule = updater && updateSourceType
    ? { updateElectronApp: updater, UpdateSourceType: updateSourceType }
    : require('update-electron-app');
  const controller = updaterModule.updateElectronApp({
    updateSource: {
      type: updaterModule.UpdateSourceType.ElectronPublicUpdateService,
      repo: UPDATE_REPOSITORY,
    },
    updateInterval: '10 minutes',
    logger,
    notifyUser: true,
  });
  return controller.stopUpdates;
}

module.exports = {
  SUPPORTED_PLATFORMS,
  UPDATE_REPOSITORY,
  createStderrLogger,
  startAutoUpdates,
};
