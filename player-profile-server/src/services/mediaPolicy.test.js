const test = require('node:test');
const assert = require('node:assert/strict');
const { validateImpressionInput } = require('./mediaPolicy');

function validInput() {
  return {
    client_submission_id: 'submission-1',
    capture_anchor_id: 'anchor-1',
    text: '印象が変わった',
    captured_at: '2026-07-13T12:34:56.789Z',
    playtime: { elapsed_ms: 5000, active_ms: 4000 },
    client: { name: 'spectator', version: '0.1.0', platform: 'windows' },
    assets: [{
      client_asset_id: 'asset-1',
      kind: 'screenshot',
      mime_type: 'image/png',
      size_bytes: 1024,
      sha256: 'a'.repeat(64),
      captured_at: '2026-07-13T12:34:56.800Z',
    }],
  };
}

test('validates and normalizes a Spectator impression', () => {
  const result = validateImpressionInput(validInput());
  assert.equal(result.elapsedMs, 5000);
  assert.equal(result.assets[0].mimeType, 'image/png');
});

test('rejects active time beyond elapsed time', () => {
  const input = validInput();
  input.playtime.active_ms = 5001;
  assert.throws(() => validateImpressionInput(input), /active_ms/);
});

test('rejects oversized and duplicate asset kinds', () => {
  const oversized = validInput();
  oversized.assets[0].size_bytes = 15 * 1024 * 1024 + 1;
  assert.throws(() => validateImpressionInput(oversized), /size limit/);

  const duplicate = validInput();
  duplicate.assets.push({ ...duplicate.assets[0], client_asset_id: 'asset-2' });
  assert.throws(() => validateImpressionInput(duplicate), /only one screenshot/);
});

test('allows a long local video only for the Volputas web review flow', () => {
  const webReview = validInput();
  webReview.client.source = 'volputas_web_review';
  webReview.assets = [{
    client_asset_id: 'video-1',
    kind: 'video',
    mime_type: 'video/mp4',
    size_bytes: 1024,
    sha256: 'b'.repeat(64),
    duration_ms: 60_000,
  }];
  assert.equal(validateImpressionInput(webReview).assets[0].durationMs, 60_000);

  const spectator = structuredClone(webReview);
  spectator.client.source = 'spectator';
  assert.throws(() => validateImpressionInput(spectator), /30000 milliseconds/);
});
