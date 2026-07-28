const test = require('node:test');
const assert = require('node:assert/strict');
const { S3MediaStorage } = require('./mediaStorage');

function configuration() {
  return {
    endpoint: 'http://minio:9000',
    publicEndpoint: 'http://127.0.0.1:59000',
    region: 'ap-northeast-1',
    bucket: 'volputas-media',
    accessKeyId: 'ACCESS',
    secretAccessKey: 'SECRET',
    forcePathStyle: true,
    uploadExpiresSeconds: 900,
    deliveryExpiresSeconds: 300,
  };
}

test('uses the public endpoint only for browser-facing signed URLs', () => {
  const storage = new S3MediaStorage(configuration());
  assert.equal(new URL(storage.createUpload('input/item.mp4', 'ab'.repeat(32)).url).host, '127.0.0.1:59000');
  assert.equal(new URL(storage.createDownload('output/item.mp4').url).host, '127.0.0.1:59000');
});
