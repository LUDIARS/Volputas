// UI vocabulary for the 15 canonical preference axes (persona.json v2).
// Order matters: it fixes the radar layout. inputHint routes "データ不足" axes
// to the page whose evidence feeds them.
export const PREFERENCE_AXIS_META = [
  { id: 'mtg.timmy', label: '豪快体験 (Timmy)', inputHint: { to: '/surveys', label: 'アンケート' } },
  { id: 'mtg.johnny', label: '自己表現 (Johnny)', inputHint: { to: '/surveys', label: 'アンケート' } },
  { id: 'mtg.spike', label: '勝利追求 (Spike)', inputHint: { to: '/surveys', label: 'アンケート' } },
  { id: 'style.achiever', label: '達成', inputHint: { to: '/gameplay', label: 'ゲームプレイ情報' } },
  { id: 'style.explorer', label: '探索', inputHint: { to: '/gameplay', label: 'ゲームプレイ情報' } },
  { id: 'style.socializer', label: '交流', inputHint: { to: '/voices', label: 'ユーザの声' } },
  { id: 'style.competitor', label: '競争', inputHint: { to: '/surveys', label: 'アンケート' } },
  { id: 'style.collector', label: '収集', inputHint: { to: '/surveys', label: 'アンケート' } },
  { id: 'style.narrative', label: '物語', inputHint: { to: '/voices', label: 'ユーザの声' } },
  { id: 'style.relaxation', label: '癒し', inputHint: { to: '/surveys', label: 'アンケート' } },
  { id: 'style.mastery', label: '習熟', inputHint: { to: '/gameplay', label: 'ゲームプレイ情報' } },
  { id: 'style.onboarding_need', label: '導入サポート', inputHint: { to: '/surveys', label: 'アンケート' } },
  { id: 'style.autonomy', label: '自律', inputHint: { to: '/surveys', label: 'アンケート' } },
  { id: 'style.routine_tolerance', label: 'ルーチン耐性', inputHint: { to: '/surveys', label: 'アンケート' } },
  { id: 'style.monetization_sensitivity', label: '課金感度', inputHint: { to: '/surveys', label: 'アンケート' } },
];

export const CONFIDENCE_META = {
  high: { label: '高', className: 'confidence-high' },
  medium: { label: '中', className: 'confidence-medium' },
  low: { label: '低', className: 'confidence-low' },
  insufficient: { label: 'データ不足', className: 'confidence-insufficient' },
};

export const AVERSION_TARGET_LABELS = {
  'style.routine_tolerance': '毎日プレイの強制',
  'style.monetization_sensitivity': '課金圧',
  'style.socializer': '対人プレイの強制',
  'aspect:story': 'ストーリー面',
  'aspect:difficulty': '難度面',
  'aspect:replayability': '周回要素',
  'aspect:price_value': '価格・課金面',
};

export function axisLabel(id) {
  return PREFERENCE_AXIS_META.find((axis) => axis.id === id)?.label || id;
}

export function aversionLabel(target) {
  return AVERSION_TARGET_LABELS[target] || target;
}
