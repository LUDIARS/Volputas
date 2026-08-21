// Chart type identifiers used by the ```chart fence (spec §グラフ). Kept in a
// plain .js module so both the overlay fence parser and node --test can use it
// without a JSX transform.
export const CHART_TYPES = Object.freeze(['hotspot', 'narrative-arc', 'trend', 'radar', 'series']);

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export function isChartType(value) {
  return CHART_TYPES.includes(String(value));
}
