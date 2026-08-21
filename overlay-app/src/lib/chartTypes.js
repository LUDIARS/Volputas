// 共有チャートパッケージ (packages/charts) の型定数だけを再輸出する。
// コンポーネントは Vite alias '@volputas/charts' から取るが、純粋ロジックは
// node --test からも読めるようにここで相対パスを 1 か所に閉じ込める。
export { CHART_TYPES, isChartType } from '../../../packages/charts/src/chartTypes.js';
