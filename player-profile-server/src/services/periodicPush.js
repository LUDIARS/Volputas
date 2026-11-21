/**
 * Start immediately, prevent overlapping batches, and release the timer on stop.
 * @implements SPEC-VO-CC-MANAGEMENT-EVENTS
 * @implements SPEC-GLAB-IMPRESSION-EXPORT
 */
function startPeriodicPush({ intervalMinutes, pusher, onError }) {
  let isRunning = false;
  const run = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await pusher.pushOnce();
    } catch {
      onError();
    } finally {
      isRunning = false;
    }
  };
  const timer = setInterval(run, intervalMinutes * 60_000);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}

module.exports = { startPeriodicPush };
