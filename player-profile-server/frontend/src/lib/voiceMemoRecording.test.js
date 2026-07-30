import test from 'node:test';
import assert from 'node:assert/strict';
import {
  preferredVoiceMemoMimeType,
  validateVoiceMemoBlob,
  voiceMemoExtension,
} from './voiceMemoRecording.js';

test('voice memo recording chooses the first supported deterministic format', () => {
  const MediaRecorderType = {
    isTypeSupported: (type) => type === 'audio/webm',
  };
  assert.equal(preferredVoiceMemoMimeType(MediaRecorderType), 'audio/webm');
  assert.equal(voiceMemoExtension('audio/webm;codecs=opus'), 'webm');
});

test('voice memo validation accepts supported audio and rejects empty recordings', () => {
  assert.equal(validateVoiceMemoBlob({ size: 12, type: 'audio/ogg;codecs=opus' }), 'audio/ogg');
  assert.throws(
    () => validateVoiceMemoBlob({ size: 0, type: 'audio/webm' }),
    /録音が空/
  );
});
