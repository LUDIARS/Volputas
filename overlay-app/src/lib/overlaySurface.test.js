import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSurfaceApi } from './overlaySurface.js';
import { normalizeSurfaceSpec, SURFACE_ALIGNS } from './surfaceSpec.js';
import { normalizeSurfaceContent } from './surfaceContent.js';
import { surfaceIdFromSearch } from './surfaceRoute.js';

function fixture() {
  const calls = { attach: [], update: [], close: [] };
  const api = createSurfaceApi({
    attach: async (request) => { calls.attach.push(request); return { id: 'surface-0', content: request.content }; },
    update: async (args) => { calls.update.push(args); },
    close: async (args) => { calls.close.push(args); },
  });
  return { api, calls };
}

const MARKDOWN = { kind: 'markdown', source: { kind: 'inline', markdown: '# hint' } };

test('attachInfo は at / offset / size / align と content をそのまま Rust へ渡す', async () => {
  const { api, calls } = fixture();
  const surface = await api.attachInfo({
    at: { viewX: 0.5, viewY: 0.2 },
    offset: { x: 0, y: -160 },
    size: { width: 360, height: 200 },
    align: 'bottom-center',
    content: MARKDOWN,
  });
  assert.equal(surface.id, 'surface-0');
  assert.deepEqual(calls.attach[0], {
    at: { viewX: 0.5, viewY: 0.2 },
    offset: { x: 0, y: -160 },
    size: { width: 360, height: 200 },
    align: 'bottom-center',
    content: MARKDOWN,
  });
});

test('省略した項目は中央・ずらし無し・既定サイズになる', async () => {
  const { api, calls } = fixture();
  await api.attachInfo({ content: MARKDOWN });
  assert.deepEqual(calls.attach[0].at, { viewX: 0.5, viewY: 0.5 });
  assert.deepEqual(calls.attach[0].offset, { x: 0, y: 0 });
  assert.deepEqual(calls.attach[0].size, { width: 360, height: 200 });
  assert.equal(calls.attach[0].align, 'middle-center');
});

test('align は 9 通りだけを受ける', () => {
  assert.equal(SURFACE_ALIGNS.length, 9);
  for (const align of SURFACE_ALIGNS) {
    assert.equal(normalizeSurfaceSpec({ align }).align, align);
  }
  assert.throws(() => normalizeSurfaceSpec({ align: 'center' }), { code: 'SURFACE_INVALID_ALIGN' });
});

test('at はビュー領域内の相対座標。枠外へ出すのは offset の役目', () => {
  assert.deepEqual(normalizeSurfaceSpec({ at: { viewX: 0, viewY: 1 } }).at, { viewX: 0, viewY: 1 });
  assert.throws(() => normalizeSurfaceSpec({ at: { viewX: 1.5, viewY: 0 } }), { code: 'SURFACE_INVALID_AT' });
  // 枠外は offset で表す (ここでは弾かない)。
  assert.deepEqual(normalizeSurfaceSpec({ offset: { x: -900, y: -900 } }).offset, { x: -900, y: -900 });
});

test('content は markdown と chart の 2 種だけ', () => {
  assert.deepEqual(normalizeSurfaceContent(MARKDOWN), MARKDOWN);
  const chart = { kind: 'chart', chart: { type: 'hotspot', source: { kind: 'inline', data: {} } } };
  assert.deepEqual(normalizeSurfaceContent(chart), chart);
  assert.throws(() => normalizeSurfaceContent({ kind: 'html', html: '<b>x</b>' }), { code: 'SURFACE_INVALID_CONTENT' });
  assert.throws(() => normalizeSurfaceContent({ kind: 'markdown' }), { code: 'SURFACE_INVALID_CONTENT' });
  assert.throws(() => normalizeSurfaceContent({ kind: 'chart' }), { code: 'SURFACE_INVALID_CONTENT' });
});

test('ハンドルは update / close を持ち、内容だけの差し替えでは矩形を送らない', async () => {
  const { api, calls } = fixture();
  const surface = await api.attachInfo({ content: MARKDOWN });
  const next = { kind: 'markdown', source: { kind: 'inline', markdown: '## 更新' } };
  await surface.update({ content: next });
  assert.deepEqual(calls.update[0], { id: 'surface-0', spec: undefined, content: next });

  await surface.update({ offset: { x: 10, y: -20 }, size: { width: 300, height: 120 } });
  assert.equal(calls.update[1].content, undefined);
  assert.deepEqual(calls.update[1].spec.offset, { x: 10, y: -20 });
  assert.deepEqual(calls.update[1].spec.size, { width: 300, height: 120 });

  await surface.close();
  assert.deepEqual(calls.close[0], { id: 'surface-0' });
  // 二重 close は無害、close 後の update は明示的に失敗する。
  await surface.close();
  assert.equal(calls.close.length, 1);
  await assert.rejects(() => surface.update({ content: next }), { code: 'SURFACE_CLOSED' });
});

test('サーフェスにはクリック透過を解除する経路が無い (パネルとの区別)', () => {
  const read = (name) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
  const wrapper = read('./overlaySurface.js');
  for (const forbidden of ['setInteractive', 'startDragging', 'setClickThrough']) {
    assert.ok(!wrapper.includes(forbidden), `${forbidden} を情報サーフェスへ持ち込まない`);
  }
  // ブリッジが渡すサーフェス用コマンドも attach / update / close / descriptor だけ。
  const bridge = read('./overlayBridge.js');
  const commands = [...bridge.matchAll(/call\('(overlay_surface_[a-z_]+)'/g)].map(([, name]) => name);
  assert.deepEqual(commands, [
    'overlay_surface_attach',
    'overlay_surface_update',
    'overlay_surface_close',
    'overlay_surface_descriptor',
  ]);
  // サーフェス側の描画も操作を受けない面として組む。
  const view = read('../panels/SurfaceView.jsx');
  for (const forbidden of ['onClick', 'onMouseEnter', 'startDragging', 'setInteractive']) {
    assert.ok(!view.includes(forbidden), `${forbidden} をサーフェスの描画に置かない`);
  }
});

test('ラッパーは overlayBridge を静的に取り込まない (依存無しで検証できる)', () => {
  // overlayBridge は @tauri-apps/api を静的 import するので、ここで静的に
  // 繋ぐと矩形・content の正規化まで Tauri の解決に巻き込まれる。
  const wrapper = readFileSync(fileURLToPath(new URL('./overlaySurface.js', import.meta.url)), 'utf8');
  const staticImports = wrapper
    .split('\n')
    .filter((line) => line.startsWith('import '))
    .map((line) => line.slice(line.indexOf("'") + 1, line.lastIndexOf("'")));
  assert.deepEqual(staticImports, ['./surfaceContent.js', './surfaceSpec.js']);
});

test('サーフェスのウインドウだけが surface エントリを描く', () => {
  assert.equal(surfaceIdFromSearch('?surface=surface-3'), 'surface-3');
  assert.equal(surfaceIdFromSearch(''), null);
  assert.equal(surfaceIdFromSearch('?surface=main'), null);
  assert.equal(surfaceIdFromSearch('?surface=../main'), null);
});
