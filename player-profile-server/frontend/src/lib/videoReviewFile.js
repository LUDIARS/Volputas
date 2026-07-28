export const MAXIMUM_VIDEO_BYTES = 200 * 1024 * 1024;

const MIME_BY_EXTENSION = Object.freeze({
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
});

export function detectVideoMimeType(file) {
  if (['video/mp4', 'video/x-matroska', 'video/webm'].includes(file.type)) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase();
  return MIME_BY_EXTENSION[extension] || null;
}

export function validateVideoFile(file) {
  if (!file || typeof file.name !== 'string' || !Number.isSafeInteger(file.size)) {
    throw new TypeError('動画ファイルが指定されていません。');
  }
  const mimeType = detectVideoMimeType(file);
  if (!mimeType) throw new Error('MP4、MKV、WebM の動画を選択してください。');
  if (file.size < 1 || file.size > MAXIMUM_VIDEO_BYTES) {
    throw new Error('動画サイズは 200MB 以下にしてください。');
  }
  return mimeType;
}
