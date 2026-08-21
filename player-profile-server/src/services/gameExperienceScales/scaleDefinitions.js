// Game-impression scales (spec/feature/game-experience-scales.md §尺度).
//
// GEQ — Game Experience Questionnaire, in-game (short) version
// (IJsselsteijn, de Kort & Poels 2013). Seven components, two items each,
// answered 0..4 ("not at all" .. "extremely"). The component scores are the
// item means.
//
// PENS — Player Experience of Need Satisfaction (Ryan, Rigby & Przybylski
// 2006). Five subscales on 1..7. The published PENS items are proprietary, so
// the wording here is Volputas' own one-item paraphrase per subscale; the
// subscale *names* and the 1..7 range follow the original so results stay
// comparable at the subscale level.
//
// Everything below is data; validation and scoring live next door.

const GEQ_RANGE = Object.freeze({ min: 0, max: 4 });
const PENS_RANGE = Object.freeze({ min: 1, max: 7 });

const GEQ_COMPONENTS = Object.freeze([
  {
    id: 'competence',
    label: '有能感',
    items: [
      { id: 'competence_1', text: '自分はうまくやれていると感じた' },
      { id: 'competence_2', text: '上達していると感じた' },
    ],
  },
  {
    id: 'immersion',
    label: '没入 (感覚・想像)',
    items: [
      { id: 'immersion_1', text: '物語や世界に引き込まれた' },
      { id: 'immersion_2', text: '見た目や音に美しさ・印象を感じた' },
    ],
  },
  {
    id: 'flow',
    label: 'フロー',
    items: [
      { id: 'flow_1', text: '周りのことを忘れて没頭した' },
      { id: 'flow_2', text: '時間の経過を忘れた' },
    ],
  },
  {
    id: 'tension',
    label: '緊張・苛立ち',
    items: [
      { id: 'tension_1', text: 'イライラした' },
      { id: 'tension_2', text: '落ち着かない気分になった' },
    ],
  },
  {
    id: 'challenge',
    label: '挑戦',
    items: [
      { id: 'challenge_1', text: '手応えのある難しさがあった' },
      { id: 'challenge_2', text: '全力を出す必要があった' },
    ],
  },
  {
    id: 'negativeAffect',
    label: 'ネガティブ感情',
    items: [
      { id: 'negativeAffect_1', text: '退屈した' },
      { id: 'negativeAffect_2', text: '他のことを考えていた' },
    ],
  },
  {
    id: 'positiveAffect',
    label: 'ポジティブ感情',
    items: [
      { id: 'positiveAffect_1', text: '楽しかった' },
      { id: 'positiveAffect_2', text: '気分が良かった' },
    ],
  },
]);

const PENS_SUBSCALES = Object.freeze([
  {
    id: 'competence',
    label: '有能感',
    items: [{ id: 'competence', text: 'このゲームでは自分の腕前を発揮できた' }],
  },
  {
    id: 'autonomy',
    label: '自律性',
    items: [{ id: 'autonomy', text: '何をどう進めるかを自分で決められた' }],
  },
  {
    id: 'relatedness',
    label: '関係性',
    items: [{ id: 'relatedness', text: '他のプレイヤーやキャラクターとつながりを感じた' }],
  },
  {
    id: 'presence',
    label: '臨場感・没入',
    items: [{ id: 'presence', text: 'ゲームの世界に自分がいるように感じた' }],
  },
  {
    id: 'intuitiveControls',
    label: '直感的な操作',
    items: [{ id: 'intuitiveControls', text: '操作は考えなくても体が動く程度に自然だった' }],
  },
]);

const SCALE_FAMILIES = Object.freeze({
  geq: Object.freeze({ id: 'geq', label: 'GEQ (in-game)', range: GEQ_RANGE, subscales: GEQ_COMPONENTS }),
  pens: Object.freeze({ id: 'pens', label: 'PENS', range: PENS_RANGE, subscales: PENS_SUBSCALES }),
});

const SCALE_FAMILY_IDS = Object.freeze(Object.keys(SCALE_FAMILIES));

module.exports = {
  GEQ_COMPONENTS,
  GEQ_RANGE,
  PENS_RANGE,
  PENS_SUBSCALES,
  SCALE_FAMILIES,
  SCALE_FAMILY_IDS,
};
