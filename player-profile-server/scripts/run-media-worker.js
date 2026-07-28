const config = require('../src/config');
const { S3MediaStorage } = require('../src/services/mediaStorage');
const { MediaCommandRunner } = require('../src/services/mediaCommandRunner');
const { MediaWorker } = require('../src/services/mediaWorker');

async function main() {
  const storage = new S3MediaStorage();
  storage.requireConfigured();
  const commands = new MediaCommandRunner(config.mediaWorker);
  await commands.verifyCapabilities();
  const worker = new MediaWorker({ storage });
  process.stdout.write(`${JSON.stringify({ level: 'info', event: 'media_worker_ready' })}\n`);
  while (true) {
    const processed = await worker.processOne();
    await worker.cleanupExpiredOriginals();
    if (!processed) await new Promise((resolve) => setTimeout(resolve, config.mediaWorker.pollSeconds * 1000));
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ level: 'error', event: 'media_worker_failed', message: error.message })}\n`);
  process.exitCode = 1;
});
