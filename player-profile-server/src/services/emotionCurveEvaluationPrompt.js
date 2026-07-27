// Pure prompt construction for emotion-curve evaluation. No I/O here so the
// exact prompt is unit-testable and deterministic for a given input.
const { EMOTION_STAMPS } = require('./profileEvidenceSchemas');

const GAME_LOG_EXCERPT_LIMIT = 20000;

const SYSTEM_PROMPT = [
  'あなたはゲームのプレイヤーリサーチアナリストです。',
  'プレイヤーがゲームプレイ動画に付けた感情曲線 (時刻ごとの盛り上がり/スキ/嫌い/ストレスのスタンプとメモ) を、',
  'そのプレイヤーのペルソナ分析および任意のゲームログと突き合わせて評価します。',
  '推測は推測と明示し、証拠 (どの時刻のどの記録か) を必ず引用してください。',
  '出力は日本語の Markdown で、診断や人物評価ではなくゲーム体験の分析として書いてください。',
].join('\n');

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}

function formatEntry(entry) {
  const stampLabel = entry.stamp ? EMOTION_STAMPS[entry.stamp]?.label ?? entry.stamp : 'なし';
  const comment = entry.comment ? ` メモ: ${entry.comment}` : '';
  return `- ${formatTime(entry.timeSeconds)} スタンプ: ${stampLabel} / 感情価 ${entry.valence} / 強さ ${entry.arousal}.${comment}`;
}

function formatPlaytime(record) {
  const lines = [];
  if (record.totalPlaytimeHours !== null && record.totalPlaytimeHours !== undefined) {
    lines.push(`- このゲームの通算プレイ時間: ${record.totalPlaytimeHours} 時間`);
  }
  if (record.sessionPlaytimeMinutes !== null && record.sessionPlaytimeMinutes !== undefined) {
    lines.push(`- このセッションのプレイ時間: ${record.sessionPlaytimeMinutes} 分`);
  }
  if (record.daysAfterPlay !== null && record.daysAfterPlay !== undefined) {
    lines.push(`- プレイから記録までの日数: ${record.daysAfterPlay} 日`);
  }
  return lines.length > 0 ? lines.join('\n') : '- プレイ時間情報なし';
}

function formatPersona(persona) {
  if (!persona || !persona.axes) {
    return 'ペルソナ分析は未実施です。ペルソナ照合の節では「分析待ち」と明記し、感情曲線単体の評価に留めてください。';
  }
  const axes = Object.values(persona.axes)
    .filter((axis) => axis.evidenceWeight > 0)
    .map((axis) => `- ${axis.label}: ${axis.score}/100 (根拠量 ${axis.evidenceWeight})`);
  const leading = (persona.leadingAxes || []).map((axis) => axis.label).join(' / ');
  return [
    `主要傾向: ${leading || 'なし'}`,
    ...axes,
    `分析日時: ${persona.analyzedAt || '不明'}`,
  ].join('\n');
}

function buildEvaluationPrompt({ record, persona, gameLogText }) {
  const sections = [
    '# 入力',
    '## 感情曲線の記録',
    `- ゲーム: ${record.gameTitle}`,
    `- セッション: ${record.sessionLabel || '名称なし'}`,
    record.narrativeArc ? `- 記録者の申告するナラティブアーク: ${record.narrativeArc}` : null,
    record.journeyStage ? `- ユーザージャーニー段階: ${record.journeyStage}` : null,
    record.playContext ? `- プレイ状況: ${record.playContext}` : null,
    '',
    '## プレイ時間',
    formatPlaytime(record),
    '',
    '## タイムライン (動画時刻順)',
    ...(record.entries || []).map(formatEntry),
    '',
    '## ペルソナ分析',
    formatPersona(persona),
  ];

  if (gameLogText) {
    const truncated = gameLogText.length > GAME_LOG_EXCERPT_LIMIT;
    sections.push(
      '',
      `## ゲームログ (抜粋${truncated ? '、先頭のみ' : ''})`,
      '```',
      gameLogText.slice(0, GAME_LOG_EXCERPT_LIMIT),
      '```'
    );
  }

  sections.push(
    '',
    '# 依頼',
    '次の 4 節構成の Markdown で評価してください。',
    '1. **ナラティブアークの分析** — 感情曲線の起伏構造 (立ち上がり・ピーク・谷・終わり方) をプレイ時間の文脈で読み解く。ピーク・エンド則の観点も含める。',
    '2. **スキ/嫌いの言語化** — スタンプとメモから、このプレイヤーが何を好み、何にストレスを感じたかを具体的な時刻を引用して言語化する。メモが無いスタンプは周辺の記録とゲームログから推測し、推測と明示する。',
    '3. **ペルソナとの照合** — ペルソナ分析の傾向と今回の感情曲線が合致する点・意外な点を挙げる。',
    '4. **開発者への示唆** — この体験の流れを踏まえ、ゲーム側で検討に値する改善仮説を 2〜3 点。'
  );

  return sections.filter((line) => line !== null).join('\n');
}

module.exports = {
  GAME_LOG_EXCERPT_LIMIT,
  SYSTEM_PROMPT,
  buildEvaluationPrompt,
};
