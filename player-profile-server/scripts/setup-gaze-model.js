// Places the local gaze-estimation runtime under frontend/public/mediapipe so
// the app serves it itself (spec/feature/emotion-capture-companion.md
// §視線推定): the MediaPipe Tasks Vision WASM files are copied out of
// node_modules, the Face Landmarker model is downloaded once (Google's public
// model bucket) or copied from VOLPUTAS_GAZE_MODEL_PATH. Nothing here runs at
// analysis time; the browser only ever talks to the local server.
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

const serverRoot = path.resolve(__dirname, '..');
const frontendRoot = path.join(serverRoot, 'frontend');
const wasmSource = path.join(frontendRoot, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const targetRoot = path.join(frontendRoot, 'public', 'mediapipe');
const wasmTarget = path.join(targetRoot, 'wasm');
const modelTarget = path.join(targetRoot, 'face_landmarker.task');

const DEFAULT_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
// The model is a few MB; anything smaller is an error page, not a model.
const MINIMUM_MODEL_BYTES = 1024 * 1024;

function secureModelUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('VOLPUTAS_GAZE_MODEL_URL must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('VOLPUTAS_GAZE_MODEL_URL must use HTTPS');
  }
  return url;
}

async function copyWasm() {
  if (!fs.existsSync(wasmSource)) {
    throw new Error(`MediaPipe runtime not installed: ${wasmSource}. Run \`npm ci\` in frontend/ first.`);
  }
  await fsPromises.mkdir(wasmTarget, { recursive: true });
  const entries = await fsPromises.readdir(wasmSource);
  for (const entry of entries) {
    await fsPromises.copyFile(path.join(wasmSource, entry), path.join(wasmTarget, entry));
  }
  process.stdout.write(`copied ${entries.length} MediaPipe wasm files to ${wasmTarget}\n`);
}

async function sha256Of(filePath) {
  const hash = createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function placeModel({ force }) {
  if (fs.existsSync(modelTarget) && !force) {
    process.stdout.write(`model already present: ${modelTarget} (sha256 ${await sha256Of(modelTarget)})\n`);
    return;
  }
  await fsPromises.mkdir(targetRoot, { recursive: true });
  const temporary = `${modelTarget}.download`;
  const localPath = process.env.VOLPUTAS_GAZE_MODEL_PATH;
  let installed = false;
  try {
    if (localPath) {
      await fsPromises.copyFile(localPath, temporary);
    } else {
      const url = secureModelUrl(process.env.VOLPUTAS_GAZE_MODEL_URL || DEFAULT_MODEL_URL);
      // Configured URLs may contain signed query parameters; never print them.
      process.stdout.write('downloading gaze model from configured HTTPS source\n');
      // A model redirect changes the artifact trust boundary. Require callers
      // to configure the final HTTPS URL explicitly instead of following it.
      const response = await fetch(url, { redirect: 'error' });
      if (!response.ok || !response.body) {
        throw new Error(`model download failed: HTTP ${response.status}`);
      }
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary, { flags: 'w' }));
    }
    const { size } = await fsPromises.stat(temporary);
    if (size < MINIMUM_MODEL_BYTES) {
      throw new Error(`model file is too small (${size} bytes); refusing to install it`);
    }
    await fsPromises.rename(temporary, modelTarget);
    installed = true;
    process.stdout.write(`installed model: ${modelTarget} (${size} bytes, sha256 ${await sha256Of(modelTarget)})\n`);
  } finally {
    if (!installed) {
      // The setup error is primary; removing a partial download is best-effort.
      await fsPromises.unlink(temporary).catch(() => {});
    }
  }
}

async function main() {
  const force = process.argv.includes('--force');
  await copyWasm();
  await placeModel({ force });
  process.stdout.write('gaze model setup complete.\n');
}

main().catch((error) => {
  process.stderr.write(`setup-gaze-model failed: ${error.message}\n`);
  process.exitCode = 1;
});
