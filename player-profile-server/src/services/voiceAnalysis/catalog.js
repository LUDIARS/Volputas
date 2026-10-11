// Versioned categorical features: presence and appraisal are not intensity scales.
const GROUPS = [
  ['a', '体験', [
    ['mastery', '上達の実感'], ['achievement', '突破・達成感'],
    ['discovery', '発見'], ['agency', '自分で選べる感覚'],
    ['expression', '自己表現'], ['connection', 'つながり'],
    ['immersion', '没入'],
  ]],
  ['emotion', '感情', [
    ['joy', '喜び'], ['fear', '恐怖'], ['boredom', '退屈'],
    ['tension', '緊張'], ['relief', '安堵'], ['frustration', '苛立ち'],
    ['surprise', '驚き'], ['sadness', '悲しみ'], ['anticipation', '期待'],
  ]],
  ['d', '遊びの振る舞い', [
    ['retry', '再挑戦'], ['experiment', '試行錯誤'],
    ['strategy_change', '戦略の変更'], ['cooperate', '協力'],
    ['compete', '競争'], ['explore', '探索'], ['wait', '待機'],
    ['resource_management', '資源のやりくり'],
  ]],
  ['appraisal', '個別の評価', [
    ['controls', '操作の応答'], ['explanation', '説明の明瞭さ'],
    ['challenge', '挑戦の手応え'], ['fairness', '公平さ・納得感'],
    ['failure_cost', '失敗時の負担'], ['pacing', 'テンポ'],
    ['reward', '報酬'], ['story', '物語'], ['social', '対人・交流'],
    ['presentation', '映像・音・演出'], ['performance', '動作の安定性'],
    ['price', '費用に見合う価値'],
  ]],
  ['preference', '希望・好み', [
    ['exploration', '探索したい'], ['competition', '競争したい'],
    ['cooperation', '協力したい'], ['short_sessions', '短時間で遊びたい'],
    ['challenge', '挑戦したい'], ['relaxation', '落ち着いて遊びたい'],
  ]],
];

const CATALOG_REVISION = 'vo-voice-features/1';
const ANALYSIS_REVISION = 'vo-voice-analysis/1';
const AXES = Object.freeze(GROUPS.flatMap(([domain, group, entries]) =>
  entries.map(([key, label]) => Object.freeze({
    id: `${domain}.${key}`, domain, group, label,
    values: Object.freeze(domain === 'appraisal'
      ? ['negative', 'neutral', 'positive']
      : domain === 'preference' ? ['avoid', 'neutral', 'seek'] : ['absent', 'present']),
  }))));
const AXIS_BY_ID = new Map(AXES.map((axis) => [axis.id, axis]));
// Separate category channels keep mixed appraisals distinct from neutral.
const DIMENSIONS = Object.freeze(AXES.flatMap((axis) =>
  axis.values.map((value) => `${axis.id}:${value}`)));
const CATALOG = Object.freeze({
  revision: CATALOG_REVISION, analysisRevision: ANALYSIS_REVISION,
  axes: AXES, dimensions: DIMENSIONS,
  projection: 'category-presence; omitted channels are not observed zeros',
});

module.exports = { AXES, AXIS_BY_ID, CATALOG, CATALOG_REVISION, ANALYSIS_REVISION, DIMENSIONS };
