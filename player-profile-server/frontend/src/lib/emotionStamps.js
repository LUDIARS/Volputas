// UI-side stamp catalog. Must stay aligned with EMOTION_STAMPS in
// src/services/profileEvidenceSchemas.js (id, valence/arousal mapping).
export const EMOTION_STAMPS = [
  { id: 'hype', emoji: '🔥', label: '盛り上がり', valence: 2, arousal: 5 },
  { id: 'like', emoji: '💖', label: 'スキ', valence: 2, arousal: 2 },
  { id: 'dislike', emoji: '💢', label: '嫌い', valence: -2, arousal: 2 },
  { id: 'stress', emoji: '😖', label: 'ストレス', valence: -2, arousal: 5 },
];

export const STAMP_BY_ID = Object.fromEntries(
  EMOTION_STAMPS.map((stamp) => [stamp.id, stamp])
);
