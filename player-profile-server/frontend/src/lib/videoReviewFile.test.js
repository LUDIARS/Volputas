import test from 'node:test';
import assert from 'node:assert/strict';
import { MAXIMUM_VIDEO_BYTES, detectVideoMimeType, validateVideoFile } from './videoReviewFile.js';

test('detects supported video MIME types from a browser type or extension', () => {
  assert.equal(detectVideoMimeType({ name: 'review.bin', type: 'video/mp4' }), 'video/mp4');
  assert.equal(detectVideoMimeType({ name: 'review.MKV', type: '' }), 'video/x-matroska');
  assert.equal(detectVideoMimeType({ name: 'review.webm', type: 'application/octet-stream' }), 'video/webm');
  assert.equal(detectVideoMimeType({ name: 'review.mov', type: 'video/quicktime' }), null);
});

test('rejects empty, oversized, and unsupported local video files', () => {
  assert.throws(() => validateVideoFile({ name: 'empty.mp4', type: 'video/mp4', size: 0 }), /200MB/);
  assert.throws(() => validateVideoFile({ name: 'large.mp4', type: 'video/mp4', size: MAXIMUM_VIDEO_BYTES + 1 }), /200MB/);
  assert.throws(() => validateVideoFile({ name: 'review.mov', type: 'video/quicktime', size: 10 }), /MP4/);
  assert.equal(validateVideoFile({ name: 'review.mp4', type: 'video/mp4', size: 10 }), 'video/mp4');
});
