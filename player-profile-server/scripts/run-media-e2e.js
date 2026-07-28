const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execute = promisify(execFile);

function loadLocalEnvironment() {
  if (!process.argv.includes('--confirm-local')) {
    throw new Error('Media E2E requires the explicit --confirm-local flag');
  }
  const environmentPath = path.join(__dirname, '..', '.env.media-dev');
  const lines = fs.readFileSync(environmentPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const separator = line.indexOf('=');
    if (separator <= 0 || line.trimStart().startsWith('#')) continue;
    const name = line.slice(0, separator).trim();
    if (process.env[name] === undefined) process.env[name] = line.slice(separator + 1).trim();
  }
  Object.assign(process.env, {
    NODE_ENV: 'test',
    AUTH_SOURCES: 'google,discord',
    DB_HOST: '127.0.0.1',
    DB_PORT: '55432',
    DB_NAME: process.env.POSTGRES_DB,
    DB_USER: process.env.POSTGRES_USER,
    DB_PASSWORD: process.env.POSTGRES_PASSWORD,
    REDIS_URL: 'redis://127.0.0.1:56379',
    MEDIA_S3_ENDPOINT: 'http://127.0.0.1:59000',
    MEDIA_S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:59000',
    MEDIA_S3_REGION: 'ap-northeast-1',
    MEDIA_S3_BUCKET: process.env.MEDIA_S3_BUCKET,
    MEDIA_S3_ACCESS_KEY_ID: process.env.MINIO_ROOT_USER,
    MEDIA_S3_SECRET_ACCESS_KEY: process.env.MINIO_ROOT_PASSWORD,
    MEDIA_S3_FORCE_PATH_STYLE: 'true',
    VOLUPTAS_PSEUDO_ID_SECRET: process.env.VOLUPTAS_PSEUDO_ID_SECRET,
  });
  if (process.env.DB_HOST !== '127.0.0.1' || process.env.DB_PORT !== '55432'
      || process.env.MEDIA_S3_ENDPOINT !== 'http://127.0.0.1:59000') {
    throw new Error('Media E2E refuses to run outside the fixed local Compose endpoints');
  }
}

async function createVideo(targetPath) {
  await execute('ffmpeg', [
    '-nostdin', '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-movflags', '+faststart', targetPath,
  ], { windowsHide: true });
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function main() {
  loadLocalEnvironment();
  const jwt = require('jsonwebtoken');
  const app = require('../src/app');
  const config = require('../src/config');
  const db = require('../src/config/database');
  const { initKeyStore, getCurrentSigningKey } = require('../src/services/jwks');

  const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'volputas-media-e2e-'));
  const videoPath = path.join(temporaryDirectory, 'review.mp4');
  const userId = crypto.randomUUID();
  let server;
  let baseUrl;
  let token;
  let impressionId;

  async function request(route, options = {}) {
    const response = await fetch(`${baseUrl}${route}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    if (response.status === 204) return null;
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(`${options.method || 'GET'} ${route} failed: ${response.status} ${result.error?.message || ''}`);
    }
    return result.data;
  }

  try {
    await createVideo(videoPath);
    const video = await fs.promises.readFile(videoPath);
    await db.query('INSERT INTO users (id, display_name) VALUES ($1, $2)', [userId, 'Media E2E']);
    await initKeyStore();
    const signingKey = await getCurrentSigningKey();
    token = jwt.sign({ sub: userId, jti: crypto.randomUUID() }, signingKey.privateKey, {
      algorithm: 'RS256',
      keyid: signingKey.kid,
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      expiresIn: '5m',
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const session = await request('/api/v1/sessions', {
      method: 'POST',
      body: JSON.stringify({ game_id: 'media-e2e', metadata: { source: 'media_e2e' } }),
    });
    const submissionId = crypto.randomUUID();
    const impression = await request(`/api/v1/sessions/${session.id}/impressions`, {
      method: 'POST',
      headers: { 'Idempotency-Key': submissionId },
      body: JSON.stringify({
        client_submission_id: submissionId,
        capture_anchor_id: crypto.randomUUID(),
        text: 'E2E video review',
        captured_at: new Date().toISOString(),
        playtime: { elapsed_ms: 2000, active_ms: 2000 },
        client: { name: 'media-e2e', version: '1', source: 'volputas_web_review' },
        assets: [{
          client_asset_id: crypto.randomUUID(),
          kind: 'video',
          mime_type: 'video/mp4',
          size_bytes: video.length,
          sha256: sha256(video),
          duration_ms: 2000,
        }],
      }),
    });
    impressionId = impression.id;
    const upload = impression.assets[0].upload;
    const uploadResponse = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: video });
    if (!uploadResponse.ok) throw new Error(`Signed media PUT failed: ${uploadResponse.status}`);
    await request(`/api/v1/impressions/${impressionId}/complete`, { method: 'POST' });

    let ready;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      ready = await request(`/api/v1/impressions/${impressionId}`);
      if (ready.status === 'ready') break;
      if (ready.status === 'rejected') throw new Error(`Worker rejected media: ${ready.rejection_reason}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (ready?.status !== 'ready') throw new Error('Media worker did not complete within 90 seconds');

    const positive = await request(`/api/v1/impressions/${impressionId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ video_offset_ms: 500, kind: 'positive', content: 'ここ良かった' }),
    });
    await request(`/api/v1/impressions/${impressionId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ video_offset_ms: 1500, kind: 'negative', content: 'ここ悪かった' }),
    });
    let reactions = await request(`/api/v1/impressions/${impressionId}/reactions`);
    if (reactions.length !== 2) throw new Error(`Expected 2 reactions, received ${reactions.length}`);
    const raw = await request(`/api/v1/impressions/${impressionId}/reactions/raw`);
    if (raw.schemaVersion !== 'spectator.reaction-raw/v2' || raw.utterances.length !== 2) {
      throw new Error('Versioned reaction raw data does not contain both reactions');
    }
    const timeline = await request(`/api/v1/impressions/${impressionId}/reactions/timeline`, {
      method: 'POST',
      body: JSON.stringify({ bin_ms: 30_000 }),
    });
    if (!timeline.id || timeline.analysis_meta?.reactionCount !== 2) {
      throw new Error('Reaction timeline was not persisted with its analysis metadata');
    }
    await request(`/api/v1/impressions/${impressionId}/reactions/${positive.id}`, { method: 'DELETE' });
    reactions = await request(`/api/v1/impressions/${impressionId}/reactions`);
    if (reactions.length !== 1 || reactions[0].kind !== 'negative') {
      throw new Error('Reaction deletion did not preserve the remaining timeline entry');
    }
    await request(`/api/v1/impressions/${impressionId}`, { method: 'DELETE' });
    impressionId = null;
    await request(`/api/v1/sessions/${session.id}`, { method: 'PATCH' });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      media_status: ready.status,
      reactions_verified: 2,
      raw_schema: raw.schemaVersion,
      timeline_id: timeline.id,
    })}\n`);
  } finally {
    if (impressionId && baseUrl && token) {
      try { await request(`/api/v1/impressions/${impressionId}`, { method: 'DELETE' }); } catch (error) {
        process.stderr.write(`Media E2E cleanup warning: ${error.message}\n`);
      }
    }
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.pool.end();
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`Media E2E failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
