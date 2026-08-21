// UI-side GEQ / PENS catalog. Must stay aligned with
// src/services/gameExperienceScales/scaleDefinitions.js (ids, ranges, item
// order). GEQ in-game: 7 components x 2 items on 0..4; PENS: 5 subscales, one
// Volputas-worded item each on 1..7.
export const SCALE_FAMILIES = [
  {
    id: 'geq',
    label: 'GEQ (in-game)',
    range: { min: 0, max: 4 },
    anchors: ['全くない', 'わずかに', 'ある程度', 'かなり', '非常に'],
    subscales: [
      { id: 'competence', label: '有能感', items: [
        { id: 'competence_1', text: '自分はうまくやれていると感じた' },
        { id: 'competence_2', text: '上達していると感じた' },
      ] },
      { id: 'immersion', label: '没入 (感覚・想像)', items: [
        { id: 'immersion_1', text: '物語や世界に引き込まれた' },
        { id: 'immersion_2', text: '見た目や音に美しさ・印象を感じた' },
      ] },
      { id: 'flow', label: 'フロー', items: [
        { id: 'flow_1', text: '周りのことを忘れて没頭した' },
        { id: 'flow_2', text: '時間の経過を忘れた' },
      ] },
      { id: 'tension', label: '緊張・苛立ち', items: [
        { id: 'tension_1', text: 'イライラした' },
        { id: 'tension_2', text: '落ち着かない気分になった' },
      ] },
      { id: 'challenge', label: '挑戦', items: [
        { id: 'challenge_1', text: '手応えのある難しさがあった' },
        { id: 'challenge_2', text: '全力を出す必要があった' },
      ] },
      { id: 'negativeAffect', label: 'ネガティブ感情', items: [
        { id: 'negativeAffect_1', text: '退屈した' },
        { id: 'negativeAffect_2', text: '他のことを考えていた' },
      ] },
      { id: 'positiveAffect', label: 'ポジティブ感情', items: [
        { id: 'positiveAffect_1', text: '楽しかった' },
        { id: 'positiveAffect_2', text: '気分が良かった' },
      ] },
    ],
  },
  {
    id: 'pens',
    label: 'PENS',
    range: { min: 1, max: 7 },
    anchors: ['全く当てはまらない', '', '', 'どちらとも言えない', '', '', '非常に当てはまる'],
    subscales: [
      { id: 'competence', label: '有能感', items: [{ id: 'competence', text: 'このゲームでは自分の腕前を発揮できた' }] },
      { id: 'autonomy', label: '自律性', items: [{ id: 'autonomy', text: '何をどう進めるかを自分で決められた' }] },
      { id: 'relatedness', label: '関係性', items: [{ id: 'relatedness', text: '他のプレイヤーやキャラクターとつながりを感じた' }] },
      { id: 'presence', label: '臨場感・没入', items: [{ id: 'presence', text: 'ゲームの世界に自分がいるように感じた' }] },
      { id: 'intuitiveControls', label: '直感的な操作', items: [{ id: 'intuitiveControls', text: '操作は考えなくても体が動く程度に自然だった' }] },
    ],
  },
];

// Item-mean per subscale for display; mirrors server scoreScales.
/** @implements SPEC-GAME-EXPERIENCE-SCALES */
export function scoreScales(scales) {
  if (!scales) return null;
  const result = {};
  for (const family of SCALE_FAMILIES) {
    const answers = scales[family.id];
    if (!answers) continue;
    const subscales = {};
    for (const subscale of family.subscales) {
      const values = subscale.items.map((item) => answers[item.id]).filter(Number.isFinite);
      if (values.length > 0) subscales[subscale.id] = values.reduce((sum, value) => sum + value, 0) / values.length;
    }
    if (Object.keys(subscales).length > 0) result[family.id] = subscales;
  }
  return Object.keys(result).length > 0 ? result : null;
}
