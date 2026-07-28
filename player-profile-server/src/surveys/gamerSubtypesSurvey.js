'use strict';

const { agreeQuestion } = require('./agreementScale');

// Follow-on survey for the 20 gamer subtypes (5 MTG psychographic types x 4 subtypes) declared
// in services/hobbyPatternDefinitions.js. Before this survey existed nothing measured them:
// detectSubtypes() could only reshuffle mechanics/story scores positionally, so the reported
// subtype carried no information about the respondent. Each item targets exactly one subtype
// key, and services/subtypeScoring.js aggregates them.
//
// Split out from `gamer-preferences` rather than appended to it: the core survey stays at 28
// questions for completion rate, and a respondent who only wants the main type never has to
// answer 20 extra items.
const SURVEY_ID = 'gamer-subtypes';
const SURVEY_VERSION = '1.0.0';

const QUESTIONS = [
  // --- Timmy/Tammy: power gamer subtypes ---
  agreeQuestion({
    id: 'subtype-timmy-power',
    text: 'とにかく大きい・強い・派手なものを実際に使えると、それだけで満足できる',
    subtype: 'timmy.power',
  }),
  agreeQuestion({
    id: 'subtype-timmy-social',
    text: 'その場が盛り上がったかどうかで、そのゲームの良し悪しを判断している',
    subtype: 'timmy.social',
  }),
  agreeQuestion({
    id: 'subtype-timmy-diversity',
    text: '毎回違う展開や違う戦い方を試したい。同じ流れの繰り返しはすぐ飽きる',
    subtype: 'timmy.diversity',
  }),
  agreeQuestion({
    id: 'subtype-timmy-adrenaline',
    text: '安全に勝つより、一発逆転や大博打の緊張感を味わいたい',
    subtype: 'timmy.adrenaline',
  }),

  // --- Johnny/Jenny: creative self-expression subtypes ---
  agreeQuestion({
    id: 'subtype-johnny-combo',
    text: 'ばらばらの要素を組み合わせて一つの大きな一手を成立させるのが一番楽しい',
    subtype: 'johnny.combo',
  }),
  agreeQuestion({
    id: 'subtype-johnny-offbeat',
    text: '誰も使わない要素や弱いとされる要素を、あえて主役にしたくなる',
    subtype: 'johnny.offbeat',
  }),
  agreeQuestion({
    id: 'subtype-johnny-uber',
    text: '自分で決めた縛りや自分ルールを課して遊ぶことがある',
    subtype: 'johnny.uber',
  }),
  agreeQuestion({
    id: 'subtype-johnny-eliminator',
    text: '勝つなら自分が狙った形で、相手に何もさせずに勝ち切りたい',
    subtype: 'johnny.eliminator',
  }),

  // --- Spike: competitive mastery subtypes ---
  agreeQuestion({
    id: 'subtype-spike-innovator',
    text: '誰も気づいていない戦術を自分で発見して、それで勝ちたい',
    subtype: 'spike.innovator',
  }),
  agreeQuestion({
    id: 'subtype-spike-tuner',
    text: '既にある強い型を細部まで調整して仕上げていく作業が好きだ',
    subtype: 'spike.tuner',
  }),
  agreeQuestion({
    id: 'subtype-spike-analyst',
    text: '確率や統計、他人の記録を調べて最適解を突き止めたい',
    subtype: 'spike.analyst',
  }),
  agreeQuestion({
    id: 'subtype-spike-nut',
    text: '勝てるなら、最強とされている型をそのまま使うことに抵抗はない',
    subtype: 'spike.nut',
  }),

  // --- Vorthos: flavor and world subtypes ---
  agreeQuestion({
    id: 'subtype-vorthos-creative',
    text: '絵柄やビジュアル、音楽の雰囲気だけでそのゲームを選ぶことがある',
    subtype: 'vorthos.creative',
  }),
  agreeQuestion({
    id: 'subtype-vorthos-collector',
    text: '作品世界にまつわる資料やグッズを手元に置いておきたい',
    subtype: 'vorthos.collector',
  }),
  agreeQuestion({
    id: 'subtype-vorthos-loremaster',
    text: '作品の歴史や年表、細かい設定まで把握しておきたい',
    subtype: 'vorthos.loremaster',
  }),
  agreeQuestion({
    id: 'subtype-vorthos-cosplayer',
    text: 'キャラクターの姿や口調、振る舞いを自分でも再現してみたくなる',
    subtype: 'vorthos.cosplayer',
  }),

  // --- Melvin: system elegance subtypes ---
  agreeQuestion({
    id: 'subtype-melvin-designer',
    text: '「自分ならこう作る」とルールや仕組みを設計し直したくなる',
    subtype: 'melvin.designer',
  }),
  agreeQuestion({
    id: 'subtype-melvin-optimizer',
    text: '無駄がなく噛み合った仕組みを見ると、それ自体が気持ちいい',
    subtype: 'melvin.optimizer',
  }),
  agreeQuestion({
    id: 'subtype-melvin-theorist',
    text: 'そのゲームの仕組みを一般化して、理屈として説明したくなる',
    subtype: 'melvin.theorist',
  }),
  agreeQuestion({
    id: 'subtype-melvin-completionist',
    text: 'システムを隅々まで理解し尽くさないと落ち着かない',
    subtype: 'melvin.completionist',
  }),
];

const SURVEY_TITLE = 'ゲーマータイプ詳細診断 — サブタイプ判定';

const SURVEY_DESCRIPTION =
  'MTGの心理分類 (Timmy/Johnny/Spike/Vorthos/Melvin) それぞれの4サブタイプ、'
  + '計20タイプを判定するアンケートです。'
  + '「ゲーム嗜好診断」で判定された主タイプの中で、どの傾向が強いかを絞り込みます。'
  + '先に「ゲーム嗜好診断」に回答しておくと結果が出ます。';

module.exports = {
  SURVEY_ID,
  SURVEY_VERSION,
  SURVEY_TITLE,
  SURVEY_DESCRIPTION,
  QUESTIONS,
};
