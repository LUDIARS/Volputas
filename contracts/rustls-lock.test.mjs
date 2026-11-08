import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import predicate from './rustls-lock.contract.mjs';
import { inspectRustlsLock } from './rustls-lock.mjs';

const lock = readFileSync(new URL('../overlay-app/src-tauri/Cargo.lock', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const baseline = lock.replace('name = "rustls"\nversion = "0.23.46"', 'name = "rustls"\nversion = "0.23.44"')
  .replace('48e13bd8c0e9365c43cfa5c9e8f9ad49d3c8444926c9aac819e0e4dc503c8fdf', '6725596c3f2c3a0aef021139e145d4eafe314a6623e4680ca83852b2c67ab2ba');

test('rustls lock contract rejects old versions, checksum corruption and unrelated changes', () => {
  const result = inspectRustlsLock(lock, baseline, 'manifest', 'manifest');
  assert.equal(predicate.post(result), true);
  assert.equal(predicate.post({ ...result, version: '0.23.44' }), false);
  assert.equal(predicate.post({ ...result, checksum: 'invalid' }), false);
  assert.equal(inspectRustlsLock(`${lock}\n# unrelated`, baseline, '', '').onlyRustlsChanged, false);
  assert.equal(inspectRustlsLock(lock, baseline, 'changed', 'original').manifestUnchanged, false);
});
