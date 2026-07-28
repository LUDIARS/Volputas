const test = require('node:test');
const assert = require('node:assert/strict');
const { presignGet, presignPut, signRequest } = require('./s3RequestSigner');

const config = {
  endpoint: 'https://objects.example.test',
  region: 'ap-northeast-1',
  bucket: 'volputas-media',
  accessKeyId: 'ACCESS',
  secretAccessKey: 'SECRET',
  forcePathStyle: true,
};

test('presigns PUT with checksum and private object path', () => {
  const upload = presignPut(config, 'impressions/user/item.png', 'ab'.repeat(32), 900,
    new Date('2026-07-13T00:00:00.000Z'));
  const url = new URL(upload.url);
  assert.equal(url.pathname, '/volputas-media/impressions/user/item.png');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
  assert.match(url.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);
  assert.equal(upload.headers['x-amz-meta-sha256'], 'ab'.repeat(32));
});

test('signs internal object requests without exposing the secret', () => {
  const request = signRequest(config, 'HEAD', 'impressions/user/item.png', {},
    new Date('2026-07-13T00:00:00.000Z'));
  assert.match(request.headers.authorization, /^AWS4-HMAC-SHA256 Credential=ACCESS\//);
  assert.doesNotMatch(request.headers.authorization, /SECRET/);
});

test('presigns an expiring private GET without exposing credentials', () => {
  const download = presignGet(config, 'processed/user/item.mp4', 300,
    new Date('2026-07-13T00:00:00.000Z'));
  const url = new URL(download.url);
  assert.equal(url.pathname, '/volputas-media/processed/user/item.mp4');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert.match(url.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);
  assert.doesNotMatch(download.url, /SECRET/);
});
