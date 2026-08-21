import test from 'node:test';
import assert from 'node:assert/strict';
import { chartPropsFor, fenceLanguageOf, parseChartFence } from './chartFence.js';

test('a spec-shaped chart fence parses into a normalized spec', () => {
  const parsed = parseChartFence('{ "type": "hotspot", "source": { "kind": "api", "path": "/api/local/overlay/charts/hotspot/1" } }');
  assert.deepEqual(parsed, {
    ok: true,
    spec: {
      type: 'hotspot',
      title: null,
      source: { kind: 'api', path: '/api/local/overlay/charts/hotspot/1' },
    },
  });
});

test('broken JSON and unknown types become error cards, not exceptions', () => {
  assert.equal(parseChartFence('{ nope').error.code, 'CHART_FENCE_INVALID_JSON');
  assert.equal(parseChartFence('[1,2]').error.code, 'CHART_FENCE_INVALID_JSON');
  assert.equal(parseChartFence('{ "type": "pie" }').error.code, 'CHART_FENCE_UNKNOWN_TYPE');
  assert.equal(parseChartFence('{}').error.code, 'CHART_FENCE_UNKNOWN_TYPE');
});

test('every source kind is validated before a fetch is attempted', () => {
  assert.equal(parseChartFence('{ "type": "trend", "source": { "kind": "ftp", "path": "x" } }').error.code, 'CHART_FENCE_INVALID_SOURCE');
  assert.equal(parseChartFence('{ "type": "trend", "source": { "kind": "file" } }').error.code, 'CHART_FENCE_INVALID_SOURCE');
  assert.equal(parseChartFence('{ "type": "trend", "source": { "kind": "inline" } }').error.code, 'CHART_FENCE_INVALID_SOURCE');
  assert.equal(
    parseChartFence('{ "type": "trend", "source": { "kind": "api", "path": "/api/v1/users/me/profile" } }').error.code,
    'CHART_FENCE_INVALID_SOURCE'
  );
  assert.equal(
    parseChartFence('{ "type": "trend", "source": { "kind": "api", "path": "/api/local/overlay/../users" } }').error.code,
    'CHART_FENCE_INVALID_SOURCE'
  );
  assert.deepEqual(
    parseChartFence('{ "type": "trend", "source": { "kind": "inline", "data": { "series": [] } } }').spec.source,
    { kind: 'inline', data: { series: [] } }
  );
});

test('chart props accept both the bare payload and the API envelope', () => {
  assert.deepEqual(chartPropsFor('hotspot', { bins: [] }), { ok: true, props: { analysis: { bins: [] } } });
  assert.deepEqual(chartPropsFor('narrative-arc', { analysis: { beats: [] } }), {
    ok: true, props: { analysis: { beats: [] } },
  });
  assert.deepEqual(chartPropsFor('trend', [1, 2]), { ok: true, props: { series: [1, 2] } });
  assert.deepEqual(chartPropsFor('series', { series: [3] }), { ok: true, props: { series: [3] } });
});

test('radar props carry the dimensions and vector the component expects', () => {
  assert.deepEqual(
    chartPropsFor('radar', { points: [[0, 1]], dimensions: ['a'], vector: [1] }),
    { ok: true, props: { points: [[0, 1]], dimensions: ['a'], vector: [1] } }
  );
});

test('a schema mismatch is reported instead of crashing the panel', () => {
  assert.equal(chartPropsFor('hotspot', null).error.code, 'CHART_DATA_SCHEMA_MISMATCH');
  assert.equal(chartPropsFor('hotspot', [1]).error.code, 'CHART_DATA_SCHEMA_MISMATCH');
  assert.equal(chartPropsFor('trend', { series: 'no' }).error.code, 'CHART_DATA_SCHEMA_MISMATCH');
  assert.equal(chartPropsFor('pie', {}).error.code, 'CHART_FENCE_UNKNOWN_TYPE');
});

test('the fence dispatcher recognizes chart and mermaid blocks only', () => {
  assert.equal(fenceLanguageOf('language-chart'), 'chart');
  assert.equal(fenceLanguageOf('language-mermaid'), 'mermaid');
  assert.equal(fenceLanguageOf('language-js'), 'js');
  assert.equal(fenceLanguageOf(undefined), null);
});
