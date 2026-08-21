// The two schools of "why is this fun" that every emotion-analysis prompt in
// Volputas must answer through (spec/feature/emotion-judgment-lenses.md).
//
// - western (機序): the single-mechanism reading. Name the theory, cite the
//   measured numbers, stay reproducible — and admit it only sees what was
//   measured.
// - eastern (全体観): the holistic, experience-based reading. Read the whole
//   curve, the quotes, the markers and the frames together and say "this
//   combination works / hurts" even when no single mechanism explains it — and
//   admit the reading depends on the reader.
//
// The LLM is asked for both, then for a 合議 (synthesis) that says where they
// agree, where they disagree, and what the other lens is blind to. The
// headings are fixed so `judgmentSections.js` can cut the answer apart
// deterministically. No I/O here.

const LENS_IDS = Object.freeze(['western', 'eastern']);

const LENSES = Object.freeze({
  western: Object.freeze({
    id: 'western',
    label: '西洋の判定 (機序)',
    heading: '## 西洋の判定 (機序)',
    stance: '単一の機序で説明する。理論名と計測値を必ず挙げ、誰が読んでも同じ結論に辿り着く形で書く。',
    method: [
      'ピーク・エンド則 / フロー / 自己決定理論 (自律性・有能感・関係性) / 円環モデルの valence×arousal など、',
      '既知の理論のどれがこの局面を説明するかを一つずつ当てる。',
      '根拠は与えられた集計・スタンプ数・生存曲線・マーカーの数値に限り、数値に無いものは「未計測」と書く。',
    ].join(''),
    weakness: '測れたものしか見ない。複数の要因が絡む「なんとなく死んでいる」を見落とす。',
  }),
  eastern: Object.freeze({
    id: 'eastern',
    label: '東洋の判定 (全体観)',
    heading: '## 東洋の判定 (全体観)',
    stance: '体験全体を一枚の流れとして読む。理由を一つに絞れなくても「この組み合わせが効いている / 壊している」と言い切る。',
    method: [
      '曲線の形、コメントの言葉遣い、スタンプの並び、マーカーとフレームの文脈を同時に眺め、',
      '数値に出ていない違和感や噛み合わせを経験則として述べる。',
      '根拠は「どの並び・どの言葉からそう読んだか」を引用し、断定の確度を自己申告する。',
    ].join(''),
    weakness: '再現性が読み手に依存する。同じ材料でも別の読み手は別の処方を出しうる。',
  }),
});

const SYNTHESIS_HEADING = '## 合議';
const AGREEMENT_LINE_PREFIX = '一致度:';
const AGREEMENT_LEVELS = Object.freeze(['高', '中', '低']);

// Fixed instruction block appended to every emotion-analysis prompt. `subject`
// names what is being judged so the wording reads naturally in each prompt.
/** @implements SPEC-EMOTION-JUDGMENT-LENSES */
function buildDualLensInstructions({ subject }) {
  const what = String(subject || 'この体験').trim() || 'この体験';
  return [
    '# 二流派の判定 (必須、見出しは一字一句そのまま使うこと)',
    `${what}について、次の三つの見出しをこの順で、本文の最後に必ず置いてください。`,
    '',
    LENSES.western.heading,
    `- 立場: ${LENSES.western.stance}`,
    `- 方法: ${LENSES.western.method}`,
    '- 書式: 「機序: <理論名>」「根拠: <引用した数値>」「処方: <直すこと>」「確度: 高 / 中 / 低」を箇条書きで。',
    '',
    LENSES.eastern.heading,
    `- 立場: ${LENSES.eastern.stance}`,
    `- 方法: ${LENSES.eastern.method}`,
    '- 書式: 「読み: <全体から読んだこと>」「根拠: <どの並び・言葉からか>」「処方: <直すこと>」「確度: 高 / 中 / 低」を箇条書きで。',
    '',
    SYNTHESIS_HEADING,
    `- 一行目は必ず「${AGREEMENT_LINE_PREFIX} 高」「${AGREEMENT_LINE_PREFIX} 中」「${AGREEMENT_LINE_PREFIX} 低」のいずれか。`,
    '- 二つの判定が一致した点 (両方が指した処方) を先に、食い違った点を次に書く。',
    `- 西洋が見落としたもの (${LENSES.western.weakness}) と東洋が示せなかった根拠 (${LENSES.eastern.weakness}) を一つずつ挙げ、`,
    '  「次に測るべきもの」か「次に観察すべきもの」に変換する。',
    '- 最終処方は一致した点から出し、食い違った点は処方にせず保留と書く。',
  ].join('\n');
}

module.exports = {
  AGREEMENT_LEVELS,
  AGREEMENT_LINE_PREFIX,
  LENSES,
  LENS_IDS,
  SYNTHESIS_HEADING,
  buildDualLensInstructions,
};
