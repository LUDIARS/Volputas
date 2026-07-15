const config = require('../config');
const sessionModel = require('../models/sessionModel');

function startSessionMaintenance({
  closeStale = sessionModel.closeStale,
  staleHours = config.spectator.staleSessionHours,
  intervalMinutes = config.spectator.maintenanceIntervalMinutes,
} = {}) {
  let isRunning = false;
  const run = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await closeStale(staleHours);
    } catch (error) {
      console.error('Failed to close stale Spectator sessions:', error);
    } finally {
      isRunning = false;
    }
  };
  const timer = setInterval(run, intervalMinutes * 60_000);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}

module.exports = { startSessionMaintenance };
