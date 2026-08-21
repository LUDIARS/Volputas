import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultOverlayProfile, validateOverlayProfile, DEFAULT_HOTKEYS } from './profileSchema.js';

test('a spec-shaped profile normalizes with the documented defaults', () => {
  const profile = validateOverlayProfile({
    schemaVersion: 1,
    name: 'KonbiniDominant プレイ中',
    target: { processName: 'KonbiniDominant.exe', titlePattern: '^Konbini' },
    placement: { mode: 'dock', side: 'right', width: 420, opacity: 0.92 },
    followZOrder: true,
    clickThrough: true,
    panels: [
      { type: 'markdown', source: { kind: 'file', path: 'E:/docs/checklist.md' } },
      {
        type: 'chart',
        chart: { type: 'hotspot', source: { kind: 'api', path: '/api/local/overlay/charts/hotspot/1' } },
      },
      { type: 'markers', hotkeys: { hype: 'Ctrl+Alt+9' } },
    ],
  });
  assert.equal(profile.placement.mode, 'dock');
  assert.equal(profile.placement.side, 'right');
  assert.equal(profile.placement.margin, 12);
  assert.equal(profile.panels[2].hotkeys.hype, 'Ctrl+Alt+9');
  assert.equal(profile.panels[2].hotkeys.comment, DEFAULT_HOTKEYS.comment);
  assert.deepEqual(profile.panels.map((panel) => panel.id), ['markdown-0', 'chart-1', 'markers-2']);
});

test('overlay mode defaults to a 9-anchor position and rejects unknown anchors', () => {
  const profile = validateOverlayProfile({
    name: 'overlay', target: { processName: 'game.exe' }, placement: { mode: 'overlay' },
  });
  assert.equal(profile.placement.anchor, 'top-right');
  assert.equal(profile.placement.side, null);
  assert.throws(() => validateOverlayProfile({
    name: 'overlay', target: { processName: 'game.exe' }, placement: { mode: 'overlay', anchor: 'middle' },
  }), { code: 'INVALID_OVERLAY_PROFILE' });
});

test('detached mode keeps the free position and ignores the anchor', () => {
  const profile = validateOverlayProfile({
    name: 'free', target: { titlePattern: '.*' }, placement: { mode: 'detached', x: -20, y: 40 },
  });
  assert.deepEqual([profile.placement.x, profile.placement.y, profile.placement.anchor], [-20, 40, null]);
});

test('an unbound target is valid but a broken regex is refused', () => {
  assert.deepEqual(validateOverlayProfile({ name: 'x', target: {} }).target, {
    processName: null,
    titlePattern: null,
  });
  assert.throws(() => validateOverlayProfile({ name: 'x', target: { titlePattern: '^(' } }), {
    code: 'INVALID_OVERLAY_PROFILE',
  });
});

test('panel contents are validated instead of reaching the renderer broken', () => {
  const base = { name: 'x', target: { processName: 'game.exe' } };
  assert.throws(() => validateOverlayProfile({ ...base, panels: [{ type: 'markdown' }] }), {
    code: 'INVALID_OVERLAY_PROFILE',
  });
  assert.throws(() => validateOverlayProfile({
    ...base, panels: [{ type: 'chart', chart: { type: 'pie' } }],
  }), { code: 'INVALID_OVERLAY_PROFILE' });
  assert.throws(() => validateOverlayProfile({
    ...base, panels: [{ type: 'markers', hotkeys: { boom: 'Ctrl+1' } }],
  }), { code: 'INVALID_OVERLAY_PROFILE' });
  assert.throws(() => validateOverlayProfile({
    ...base,
    panels: [{ type: 'markdown', source: { kind: 'api', path: '/api/v1/users/me/profile' } }],
  }), { code: 'INVALID_OVERLAY_PROFILE' });
});

test('the default profile is valid and click-through by default', () => {
  const profile = defaultOverlayProfile();
  assert.equal(profile.clickThrough, true);
  assert.equal(profile.followZOrder, true);
  assert.deepEqual(profile.target, { processName: null, titlePattern: null });
  assert.equal(profile.panels[0].type, 'markers');
});

test('profile names support display text but reject unsafe file names', () => {
  assert.equal(defaultOverlayProfile('Konbini プレイ中').name, 'Konbini プレイ中');
  assert.throws(() => defaultOverlayProfile('../escape'), { code: 'INVALID_OVERLAY_PROFILE' });
  assert.throws(() => defaultOverlayProfile('game:profile'), { code: 'INVALID_OVERLAY_PROFILE' });
});
