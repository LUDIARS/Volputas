export const VOICE_MEMO_MAX_BYTES = 50 * 1024 * 1024;

const MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

export function preferredVoiceMemoMimeType(MediaRecorderType) {
  if (!MediaRecorderType) return '';
  if (typeof MediaRecorderType.isTypeSupported !== 'function') return '';
  return MIME_TYPES.find((type) => MediaRecorderType.isTypeSupported(type)) || '';
}

export function voiceMemoExtension(mimeType) {
  const baseType = String(mimeType || '').split(';')[0].trim();
  return {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
  }[baseType] || 'webm';
}

export function validateVoiceMemoBlob(blob) {
  if (!blob || blob.size === 0) {
    throw new Error('録音が空です。もう一度録音してください。');
  }
  if (blob.size > VOICE_MEMO_MAX_BYTES) {
    throw new Error('録音は50MB以下にしてください。');
  }
  const baseType = String(blob.type || '').split(';')[0].trim();
  if (!['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'].includes(baseType)) {
    throw new Error(`未対応の音声形式です: ${baseType || '不明'}`);
  }
  return baseType;
}
