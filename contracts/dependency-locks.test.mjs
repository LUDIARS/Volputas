import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inspectOverlayLock, inspectServerLock } from './dependency-locks.mjs';
import overlayContract from './overlay-lock.contract.mjs';
import serverContract from './server-lock.contract.mjs';

const readLock = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('overlay pins the allowed fixed version and rejects old versions or corrupted integrity', () => {
  const result = inspectOverlayLock(readLock('../overlay-app/package-lock.json'));
  assert.equal(overlayContract.post(result), true);
  const old = structuredClone(result);
  old.entry.version = '3.4.15';
  assert.equal(overlayContract.post(old), false);
  const corrupt = structuredClone(result);
  corrupt.entry.integrity = 'sha512-invalid';
  assert.equal(overlayContract.post(corrupt), false);
});

test('server updates only the allowed qs instance and retains the incompatible express instance', () => {
  const result = inspectServerLock(readLock('../player-profile-server/package-lock.json'));
  assert.equal(serverContract.post(result), true);
  const old = structuredClone(result);
  old.entry.version = '6.16.0';
  assert.equal(serverContract.post(old), false);
  const outsideRange = structuredClone(result);
  outsideRange.retained.version = '6.16.2';
  assert.equal(serverContract.post(outsideRange), false);
  const changedParent = structuredClone(result);
  changedParent.expressRange = '^6.15.1';
  assert.equal(serverContract.post(changedParent), false);
});
