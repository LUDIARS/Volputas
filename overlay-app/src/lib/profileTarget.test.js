import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultOverlayProfile } from './profileSchema.js';
import { persistWindowTarget, targetForWindow } from './profileTarget.js';

test('a selected window becomes a persistent process target', async () => {
  const saved = [];
  const profile = defaultOverlayProfile('game-profile');
  const result = await persistWindowTarget(
    profile,
    { processName: 'game.exe', title: 'Game' },
    async (next) => {
      saved.push(next);
      return next;
    }
  );
  assert.deepEqual(saved[0].target, { processName: 'game.exe', titlePattern: null });
  assert.deepEqual(result.target, saved[0].target);
});

test('a window without a process name cannot replace the saved target', () => {
  assert.throws(() => targetForWindow({ title: 'Unknown' }), { code: 'INVALID_WINDOW_TARGET' });
});
