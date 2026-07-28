// Fixed experience-card deck for pairwise comparison (design §4.1): two cards
// per canonical axis, each mapping straight onto the 15-axis vocabulary. Card
// ids are stable — comparison records reference them, so never renumber.
const EXPERIENCE_CARDS = Object.freeze([
  { id: 'exp-timmy-spectacle', text: '画面いっぱいの派手な大技を叩き込む', axes: [['mtg.timmy', 1]] },
  { id: 'exp-timmy-chaos', text: '滅茶苦茶な状況を全力で楽しむ', axes: [['mtg.timmy', 1]] },
  { id: 'exp-johnny-original', text: '自分だけの戦法やデッキを組み上げる', axes: [['mtg.johnny', 1]] },
  { id: 'exp-johnny-express', text: '作った作品やプレイを人に見せる', axes: [['mtg.johnny', 0.6], ['style.socializer', 0.4]] },
  { id: 'exp-spike-win', text: '格上の相手に勝って実力を証明する', axes: [['mtg.spike', 1]] },
  { id: 'exp-spike-optimize', text: '最適解を突き詰めて無駄なく勝つ', axes: [['mtg.spike', 0.6], ['style.mastery', 0.4]] },
  { id: 'exp-achieve-complete', text: '実績やトロフィーを 100% にする', axes: [['style.achiever', 1]] },
  { id: 'exp-achieve-clear', text: 'クリアの瞬間の達成感を味わう', axes: [['style.achiever', 1]] },
  { id: 'exp-explore-map', text: '地図の隅々まで踏破して秘密を見つける', axes: [['style.explorer', 1]] },
  { id: 'exp-explore-unknown', text: '誰も知らない場所や仕様を掘り当てる', axes: [['style.explorer', 1]] },
  { id: 'exp-social-coop', text: '仲間と協力して強敵を倒す', axes: [['style.socializer', 1]] },
  { id: 'exp-social-hangout', text: 'ゲーム内でだべりながら遊ぶ', axes: [['style.socializer', 1]] },
  { id: 'exp-compete-rank', text: 'ランキング上位を目指して競う', axes: [['style.competitor', 1]] },
  { id: 'exp-compete-duel', text: '実力伯仲の対戦で競り勝つ', axes: [['style.competitor', 1]] },
  { id: 'exp-collect-all', text: 'アイテムやカードをコンプリートする', axes: [['style.collector', 1]] },
  { id: 'exp-collect-rare', text: 'レアな一品を引き当てて所有する', axes: [['style.collector', 1]] },
  { id: 'exp-story-ending', text: '物語の結末を見届けて余韻に浸る', axes: [['style.narrative', 1]] },
  { id: 'exp-story-character', text: 'キャラクターの背景や関係性を味わう', axes: [['style.narrative', 1]] },
  { id: 'exp-relax-heal', text: '癒しの世界でのんびり過ごす', axes: [['style.relaxation', 1]] },
  { id: 'exp-relax-idle', text: '何も考えずに手を動かして落ち着く', axes: [['style.relaxation', 1]] },
  { id: 'exp-mastery-highdiff', text: '高難度を何度も挑んで突破する', axes: [['style.mastery', 1]] },
  { id: 'exp-mastery-skill', text: '操作精度を磨いて上達を実感する', axes: [['style.mastery', 1]] },
  { id: 'exp-onboarding-guided', text: '丁寧なチュートリアルで迷わず始める', axes: [['style.onboarding_need', 1]] },
  { id: 'exp-onboarding-clear', text: '次にやることが常に示されている', axes: [['style.onboarding_need', 1]] },
  { id: 'exp-autonomy-freedom', text: '目的を自分で決めて自由に動く', axes: [['style.autonomy', 1]] },
  { id: 'exp-autonomy-sandbox', text: 'サンドボックスで好き勝手に実験する', axes: [['style.autonomy', 0.7], ['mtg.johnny', 0.3]] },
  { id: 'exp-routine-daily', text: '毎日のデイリーを淡々とこなす', axes: [['style.routine_tolerance', 1]] },
  { id: 'exp-routine-grind', text: '同じ周回を重ねて着実に積み上げる', axes: [['style.routine_tolerance', 0.7], ['style.collector', 0.3]] },
  { id: 'exp-monetize-support', text: '推し要素に課金して応援する', axes: [['style.monetization_sensitivity', 1]] },
  { id: 'exp-monetize-value', text: '買い切りで全部遊べる安心感を選ぶ', axes: [['style.monetization_sensitivity', 1]] },
]);

const CARD_BY_ID = new Map(EXPERIENCE_CARDS.map((card) => [card.id, card]));

module.exports = { CARD_BY_ID, EXPERIENCE_CARDS };
