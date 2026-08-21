// Pure prompt construction for the cross-session narrative-arc commentary
// (spec/feature/narrative-arc.md §LLM 解説). The deterministic aggregate is the
// evidence; the LLM only reads it and writes prose, never re-derives numbers.
const { EMOTION_STAMPS } = require('../profileEvidenceSchemas');
const { buildDualLensInstructions } = require('../emotionJudgment/judgmentLenses');

const SYSTEM_PROMPT = [
  'あなたはゲームのプレイヤーリサーチアナリストです。',
  '同じプレイヤーが同じゲームを複数回プレイして記録した感情曲線を、決定的な集計 (平均アーク・形状分類・',
  'ピーク/谷/終端・セッション間の傾向) と合わせて読み、そのプレイヤーにとってのナラティブアークを言語化します。',
  '数値の再計算はせず、与えられた集計を引用して解釈してください。推測は推測と明示してください。',
  '出力は日本語の Markdown で、人物評価ではなくゲーム体験の分析として書いてください。',
].join('\n');

const OUTPUT_INSTRUCTIONS = [
  '# 出力構成',
  '1. アークの要約 — 形状分類と相関を引用し、平均アークが何を語るかを 3〜5 文で。',
  '2. ピーク / 谷 / 終端 — どの進行位置で何が起きているか。各セッションのメモやスタンプを引用する。',
  '3. セッション間の変化 — 回を重ねての傾向 (慣れ・熟達・飽き) と一貫性の解釈。',
  '4. プレイヤー申告アークとの照合 — 申告があれば集計との合致・ズレを述べる。無ければその旨。',
  '5. 開発者への示唆 — このプレイヤーの体験構造から導ける具体的な改善仮説を箇条書きで。',
  '6. 二流派の判定 — 下の「二流派の判定」の見出しと書式に従い、このプレイヤーのアーク全体に対して書く。',
].join('\n');

const DUAL_LENS_INSTRUCTIONS = buildDualLensInstructions({ subject: 'このプレイヤーのナラティブアーク' });

function percent(position) {
  return `${Math.round(position * 100)}%`;
}

function formatSeries(values) {
  return values.map((value) => (value === null || value === undefined ? '－' : value.toFixed(1))).join(' ');
}

function formatStampCounts(counts) {
  const parts = Object.entries(counts || {})
    .map(([id, count]) => `${EMOTION_STAMPS[id]?.label ?? id}×${count}`);
  return parts.length > 0 ? parts.join(', ') : 'スタンプなし';
}

/** @implements SPEC-NARRATIVE-ARC */
function formatSession(session, index) {
  const lines = [
    `### セッション ${index + 1}: ${session.sessionLabel || '名称なし'} (${session.mode})`,
    `- 記録日時: ${session.createdAt || '不明'}` + (session.daysAfterPlay !== null && session.daysAfterPlay !== undefined
      ? ` / プレイ後 ${session.daysAfterPlay} 日` : ''),
    session.totalPlaytimeHours !== null && session.totalPlaytimeHours !== undefined
      ? `- 通算プレイ時間: ${session.totalPlaytimeHours} 時間` : null,
    session.sessionPlaytimeMinutes !== null && session.sessionPlaytimeMinutes !== undefined
      ? `- セッション時間: ${session.sessionPlaytimeMinutes} 分` : null,
    `- 記録数 ${session.summary.entryCount} / 平均感情価 ${session.summary.meanValence ?? '－'} / 平均強さ ${session.summary.meanArousal ?? '－'} / ピーク位置 ${session.summary.peakPosition === null ? '－' : percent(session.summary.peakPosition)}`,
    `- スタンプ: ${formatStampCounts(session.summary.stampCounts)}`,
    session.declaredArc ? `- プレイヤー申告アーク: ${session.declaredArc}` : null,
    `- 感情価の推移 (0→100%): ${formatSeries(session.valence)}`,
  ];
  return lines.filter(Boolean).join('\n');
}

/** @implements SPEC-NARRATIVE-ARC */
function formatEntries(records) {
  const lines = [];
  for (const record of records) {
    for (const entry of record.entries || []) {
      if (!entry.comment && !entry.stamp) continue;
      const at = record.mode === 'memory'
        ? `${entry.position}%地点`
        : `${Math.floor((entry.timeSeconds || 0) / 60)}:${String(Math.floor((entry.timeSeconds || 0) % 60)).padStart(2, '0')}`;
      const stamp = entry.stamp ? EMOTION_STAMPS[entry.stamp]?.label ?? entry.stamp : 'なし';
      lines.push(`- [${record.sessionLabel || record.id}] ${at} スタンプ ${stamp} / 感情価 ${entry.valence} / 強さ ${entry.arousal}${entry.comment ? ` メモ: ${entry.comment}` : ''}`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : '- (メモ・スタンプ付きの記録なし)';
}

/** @implements SPEC-NARRATIVE-ARC */
function buildNarrativeArcPrompt({ gameTitle, analysis, records }) {
  const shape = analysis.shape || {};
  const sections = [
    '# 入力',
    `## ゲーム: ${gameTitle}`,
    `- セッション数: ${analysis.sessionCount}`,
    '',
    '## 平均アーク (決定的集計)',
    `- 形状分類: ${shape.label || '判定不能'}${shape.correlation !== null && shape.correlation !== undefined ? ` (相関 ${shape.correlation})` : ''}`,
    shape.candidates && shape.candidates.length > 1
      ? `- 次点: ${shape.candidates.slice(1, 3).map((candidate) => `${candidate.label} (${candidate.correlation})`).join(' / ')}`
      : null,
    `- ピーク: ${analysis.peak ? `${percent(analysis.peak.position)} 地点, 感情価 ${analysis.peak.valence}` : '－'}`,
    `- 谷: ${analysis.valley ? `${percent(analysis.valley.position)} 地点, 感情価 ${analysis.valley.valence}` : '－'}`,
    `- 終端の感情価: ${analysis.ending ?? '－'} / ピーク・エンド指標: ${analysis.peakEnd ?? '－'}`,
    `- セッション間の一貫性 (平均相関): ${analysis.consistency ?? '－'}`,
    `- 回を重ねた傾向 (平均感情価の傾き/回): ${analysis.trend?.slope ?? '－'}`,
    `- 平均感情価の推移 (0→100%): ${formatSeries((analysis.bins || []).map((bin) => bin.valence))}`,
    `- 平均強さの推移 (0→100%): ${formatSeries((analysis.bins || []).map((bin) => bin.arousal))}`,
    '',
    '## セッション別',
    ...(analysis.sessions || []).map(formatSession),
    '',
    '## 記録の原文 (メモ・スタンプ)',
    formatEntries(records || []),
    '',
    OUTPUT_INSTRUCTIONS,
    '',
    DUAL_LENS_INSTRUCTIONS,
  ];
  return sections.filter((line) => line !== null).join('\n');
}

module.exports = { OUTPUT_INSTRUCTIONS, SYSTEM_PROMPT, buildNarrativeArcPrompt };
