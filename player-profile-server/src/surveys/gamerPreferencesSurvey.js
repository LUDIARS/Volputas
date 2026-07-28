'use strict';

const { agreeQuestion } = require('./agreementScale');

// Core survey of the suite: one item per 12-dimension trait and per 15-axis style trait.
// Deliberately kept at its original 28 questions so already-collected `gamer-preferences`
// responses stay comparable; the subtype and emotion coverage that used to be missing lives
// in sibling surveys (see surveyCatalog.js) instead of inflating this one past completion rate.
const SURVEY_ID = 'gamer-preferences';
const SURVEY_VERSION = '1.0.0';

// One question per unique dimension/axis target — no redundant coverage. The 3 MTG core
// questions carry both `dimension` and `axis` because those concepts overlap 1:1
// (gamer_timmy/johnny/spike <-> mtg.timmy/johnny/spike); everything else only exists in one
// of the two systems.
const SCORED_QUESTIONS = [
  // --- MTG gamer pattern core (dimension + axis) ---
  agreeQuestion({
    id: 'mtg-timmy-power-fantasy',
    text: '派手な演出や圧倒的なパワーを実感できると、それだけで満足感がある',
    dimension: 'power_fantasy',
    axis: 'mtg.timmy',
  }),
  agreeQuestion({
    id: 'mtg-johnny-self-expression',
    text: '自分なりの工夫やコンボを見つけて実践するのが好きだ',
    dimension: 'self_expression',
    axis: 'mtg.johnny',
  }),
  agreeQuestion({
    id: 'mtg-spike-winning',
    text: '勝率や結果にこだわり、常に最適な選択をしたい',
    dimension: 'winning',
    axis: 'mtg.spike',
  }),

  // --- Gamer pattern: Vorthos / Melvin (dimensionのみ、対応する15軸なし) ---
  agreeQuestion({
    id: 'gamer-vorthos-flavor',
    text: '世界観やキャラクターの背景設定を読み込むのが好きだ',
    dimension: 'flavor_story',
  }),
  agreeQuestion({
    id: 'gamer-melvin-system',
    text: 'ゲームのルールや数値バランスがどう設計されているか気になる',
    dimension: 'system_design',
  }),

  // --- Mechanics pattern (Caillois) ---
  agreeQuestion({
    id: 'mechanics-agon-competition',
    text: '他人と競い合い、実力を試すような場面に燃える',
    dimension: 'competition',
  }),
  agreeQuestion({
    id: 'mechanics-alea-luck',
    text: '運や確率に左右される展開にワクワクする',
    dimension: 'luck_chance',
  }),
  agreeQuestion({
    id: 'mechanics-ilinx-thrill',
    text: 'スピード感やスリル、感覚が揺さぶられる体験が好きだ',
    dimension: 'thrill_rush',
  }),
  agreeQuestion({
    id: 'mechanics-mimicry-roleplay',
    text: 'キャラクターになりきったり、役割を演じたりするのが楽しい',
    dimension: 'roleplay',
  }),

  // --- Story dynamics (Berne) ---
  agreeQuestion({
    id: 'story-winner-goal',
    text: '目標を立てて着実に達成していく過程にやりがいを感じる',
    dimension: 'goal_achievement',
  }),
  agreeQuestion({
    id: 'story-banal-routine',
    text: '決まった日課やルーティンとしてゲームを続けるのが心地よい',
    dimension: 'daily_routine',
  }),
  agreeQuestion({
    id: 'story-loser-struggle',
    text: 'うまくいかない状況が続いても、それ自体をゲームの一部として楽しめる',
    dimension: 'challenge_struggle',
  }),

  // --- 15軸 style (axisのみ、対応するdimensionなし) ---
  agreeQuestion({
    id: 'style-achiever',
    text: '実績解除やスコア、進捗バーを埋めることに強いモチベーションを感じる',
    axis: 'style.achiever',
  }),
  agreeQuestion({
    id: 'style-explorer',
    text: '隠し要素や未知のエリアを自分で見つけ出すのが楽しい',
    axis: 'style.explorer',
  }),
  agreeQuestion({
    id: 'style-socializer',
    text: '友人と一緒に遊んだり交流したりすること自体が目的になる',
    axis: 'style.socializer',
  }),
  agreeQuestion({
    id: 'style-competitor',
    text: 'ランキングや対人戦で他人と比較されることにやる気が出る',
    axis: 'style.competitor',
  }),
  agreeQuestion({
    id: 'style-collector',
    text: 'キャラクターやアイテムを揃えてコレクションするのが好きだ',
    axis: 'style.collector',
  }),
  agreeQuestion({
    id: 'style-narrative',
    text: 'ストーリーや会話、世界観の深さを重視してゲームを選ぶ',
    axis: 'style.narrative',
  }),
  agreeQuestion({
    id: 'style-relaxation',
    text: '短時間で気軽に息抜きできるゲームを求めている',
    axis: 'style.relaxation',
  }),
  agreeQuestion({
    id: 'style-mastery',
    text: '難しい操作や高難度な内容を練習して上達するのが好きだ',
    axis: 'style.mastery',
  }),
  agreeQuestion({
    id: 'style-onboarding-need',
    text: '新しいゲームを始めるとき、丁寧なチュートリアルがないと不安になる',
    axis: 'style.onboarding_need',
  }),
  agreeQuestion({
    id: 'style-autonomy',
    text: '説明を読むより自分で触って試行錯誤する方が好きだ',
    axis: 'style.autonomy',
  }),
  agreeQuestion({
    id: 'style-routine-tolerance',
    text: 'ログインボーナスや期間限定イベントのような日課要素を苦にしない',
    axis: 'style.routine_tolerance',
  }),
  agreeQuestion({
    id: 'style-monetization-sensitivity',
    text: '課金額やガチャの確率、報酬の差に敏感な方だ',
    axis: 'style.monetization_sensitivity',
  }),
];

// 好きなゲームの傾向 — スコアリングせず回答をそのまま残す。
// genre/experience の選択肢は Discutere の合成ペルソナ生成 (src/flow/survey.ts の GENRES /
// EMOTION_SEEKS) と同じ語彙に揃え、サービス間で集計・比較しやすくしている。
const DESCRIPTIVE_QUESTIONS = [
  {
    id: 'favorite-genre',
    type: 'choice',
    text: '好きなゲームジャンルを教えてください',
    options: [
      { value: 'roguelike', label: 'ローグライク' },
      { value: 'gacha', label: 'ガチャ・ソシャゲ' },
      { value: 'fps', label: 'FPS' },
      { value: 'rpg', label: 'RPG' },
      { value: 'puzzle', label: 'パズル' },
      { value: 'action', label: 'アクション' },
      { value: 'strategy', label: 'ストラテジー' },
      { value: 'horror', label: 'ホラー' },
      { value: 'simulation', label: 'シミュレーション' },
      { value: 'fighting', label: '対戦・格闘' },
      { value: 'other', label: 'その他' },
    ],
  },
  {
    id: 'favorite-experience',
    type: 'choice',
    text: 'ゲームに一番求める体験はどれですか?',
    options: [
      { value: 'excitement', label: '興奮' },
      { value: 'tension', label: '緊張' },
      { value: 'achievement', label: '達成感' },
      { value: 'healing', label: '癒し' },
      { value: 'immersion', label: '没入' },
      { value: 'social', label: '交流' },
      { value: 'collection', label: '収集' },
      { value: 'growth', label: '成長' },
    ],
  },
  {
    // affectProfile.js averages every freetext answer into the 20-dimension affect vector.
    // Title lists are mostly proper nouns and carry almost no affect signal, so they are
    // down-weighted against the emotion survey's narrative answers (weight 2-3) rather than
    // dominating the vector just by being the oldest freetext question.
    id: 'favorite-titles',
    type: 'freetext',
    text: '好きなゲームタイトルを教えてください(複数可)',
    weight: 0.5,
  },
  {
    id: 'play-platform',
    type: 'choice',
    text: '普段どの環境でゲームを遊びますか?',
    options: [
      { value: 'pc', label: 'PC (Steam等)' },
      { value: 'console', label: '家庭用ゲーム機' },
      { value: 'mobile', label: 'スマートフォン' },
      { value: 'mixed', label: '複数の環境' },
      { value: 'other', label: 'その他' },
    ],
  },
];

const QUESTIONS = [...SCORED_QUESTIONS, ...DESCRIPTIVE_QUESTIONS];

const SURVEY_TITLE = 'ゲーム嗜好診断 — Timmy/Johnny/Spikeタイプ・プレイスタイル診断';

const SURVEY_DESCRIPTION =
  'MTGのTimmy/Johnny/Spike心理分類 (+Vorthos/Melvin)、Caillois の遊びの4分類、' +
  'Berneのライフスクリプトによる12次元の「Gamer / Mechanics / Story」診断と、' +
  'Bartle気質を拡張した15軸のプレイスタイル診断を1本にまとめたアンケートです。' +
  '好きなジャンルやタイトルもあわせて教えてください。' +
  'Steamのゲーム記録を連携したい場合は設定画面から連携できます。';

module.exports = {
  SURVEY_ID,
  SURVEY_VERSION,
  SURVEY_TITLE,
  SURVEY_DESCRIPTION,
  QUESTIONS,
};
