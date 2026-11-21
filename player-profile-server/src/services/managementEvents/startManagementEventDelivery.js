const { createManagementEventDelivery } = require('./managementEventDelivery');
const { startPeriodicPush } = require('../periodicPush');

const INTERVAL_MINUTES = 1;

/** @implements SPEC-VO-CC-MANAGEMENT-EVENTS */
function startManagementEventDelivery({ url, store, startPush = startPeriodicPush, warn = console.warn }) {
  if (!url) return null;
  const controller = new AbortController();
  const stopPush = startPush({
    intervalMinutes: INTERVAL_MINUTES,
    pusher: createManagementEventDelivery({ store, url, signal: controller.signal, warn }),
    onError: () => warn('[cc-management-events] pending (reason=unexpected)'),
  });
  return () => {
    stopPush();
    controller.abort();
  };
}

module.exports = { startManagementEventDelivery };
