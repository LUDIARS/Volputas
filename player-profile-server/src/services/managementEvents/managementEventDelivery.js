const { toAiManagementEvent, toHumanManagementEvent } = require('./managementEventPayload.mjs');
const { postManagementEvent } = require('./managementEventsClient.mjs');

const BATCH_LIMIT = 25;
const LOG_LABEL = '[cc-management-events]';

/** @implements SPEC-VO-CC-MANAGEMENT-EVENTS */
function createManagementEventDelivery({ store, url, signal, fetchImpl, warn = console.warn }) {
  async function pushBatch(list, toEvent) {
    const rows = await list(BATCH_LIMIT);
    for (const row of rows) {
      if (signal?.aborted) break;
      const event = toEvent(row);
      const result = await postManagementEvent({ url, event, signal, fetchImpl });
      if (signal?.aborted && result.status === null) break;
      if (result.state !== 'delivered') {
        warn(`${LOG_LABEL} ${result.state} (kind=${event.kind}, status=${result.status ?? 'network_error'})`);
      }
      try {
        await store.recordAttempt(event.origin, row.id, result);
      } catch {
        // An unrecorded attempt is retried under the same Concordia event key.
        warn(`${LOG_LABEL} pending (reason=record_attempt_failed)`);
      }
    }
  }

  return {
    async pushOnce() {
      const batches = [
        [store.listPendingAi, toAiManagementEvent],
        [store.listPendingHuman, toHumanManagementEvent],
      ];
      for (const [list, toEvent] of batches) {
        if (signal?.aborted) return;
        try {
          await pushBatch(list, toEvent);
        } catch {
          warn(`${LOG_LABEL} pending (reason=batch_failed)`);
        }
      }
    },
  };
}

module.exports = { createManagementEventDelivery };
