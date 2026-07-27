'use strict';

// Narrative survey that feeds the 20-dimension affect vector (services/affectProfile.js).
// affectProfile only reads `freetext` answers, and the only freetext question that existed was
// `favorite-titles` — a list of proper nouns with almost no affect signal, which made the
// stored vector noise rather than a profile. These questions ask about moments instead of
// titles so the text actually carries emotion.
//
// `weight` is honoured by affectProfile.collectFreeTextSamples as the weighted-mean weight.
// Questions about what went wrong (quit / frustration) and the single strongest memory carry
// the most signal, so they are weighted above the ones that invite polite, flat answers.
const SURVEY_ID = 'gamer-emotions';
const SURVEY_VERSION = '1.0.0';

const EMOTION_MAX_WEIGHT = 3;

function emotionQuestion({ id, text, weight }) {
  if (!(weight > 0) || weight > EMOTION_MAX_WEIGHT) {
    // A zero/negative/oversized weight silently distorts the whole affect vector instead of
    // failing, so reject it while the definition is being loaded.
    throw new RangeError(`Emotion question weight must be within (0, ${EMOTION_MAX_WEIGHT}]: ${id}`);
  }
  return { id, type: 'freetext', text, weight };
}

const QUESTIONS = [
  emotionQuestion({
    id: 'emotion-peak-moment',
    text: 'これまで遊んだゲームで、一番心が動いた瞬間はどんな場面でしたか。'
      + 'そのときどう感じたかも一緒に書いてください',
    weight: 3,
  }),
  emotionQuestion({
    id: 'emotion-quit-reason',
    text: '途中でやめてしまったゲームについて、やめた理由と、やめたときの気持ちを教えてください',
    weight: 3,
  }),
  emotionQuestion({
    id: 'emotion-frustration',
    text: 'ゲームで悔しかった・腹が立った体験を、そのときの気持ちごと教えてください',
    weight: 3,
  }),
  emotionQuestion({
    id: 'emotion-recommend',
    text: '誰かに勧めたくなったゲームについて、何をどう伝えたくなったか教えてください',
    weight: 2,
  }),
  emotionQuestion({
    id: 'emotion-spending',
    text: '課金や購入を決めた瞬間の気持ちを教えてください。'
      + '課金したことがなければ、なぜしないのかを教えてください',
    weight: 2,
  }),
];

const SURVEY_TITLE = 'ゲーム体験の記述 — 感情傾向の分析';

const SURVEY_DESCRIPTION =
  '選択式ではなく、実際の体験を自由に書いてもらうアンケートです。'
  + '書かれた文章から20次元の感情傾向ベクトルを算出し、'
  + '選択式では出てこない好き嫌いの手触りを分析に反映します。'
  + '文章の内容そのものは分析以外の用途に使いません。';

module.exports = {
  EMOTION_MAX_WEIGHT,
  SURVEY_ID,
  SURVEY_VERSION,
  SURVEY_TITLE,
  SURVEY_DESCRIPTION,
  QUESTIONS,
};
