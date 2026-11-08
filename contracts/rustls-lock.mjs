import { contract } from './contract-runtime.mjs'; /* augur-inject:import:1536de8c */
import augurContract_7f9c4931 from './rustls-lock.contract.mjs'; /* augur-inject:contract-predicate:7e44d4b8 */
// Inspect lockfile text without resolving, downloading, or executing Rust crates.
export function inspectRustlsLock(lock, baseline, manifest, baselineManifest) {
  // Git stores LF while Windows worktrees may use CRLF; compare logical text.
  lock = lock.replaceAll('\r\n', '\n');
  baseline = baseline.replaceAll('\r\n', '\n');
  manifest = manifest.replaceAll('\r\n', '\n');
  baselineManifest = baselineManifest.replaceAll('\r\n', '\n');
  const entry = /\[\[package\]\]\r?\nname = "rustls"\r?\nversion = "([^"]+)"\r?\nsource = "registry\+https:\/\/github.com\/rust-lang\/crates.io-index"\r?\nchecksum = "([^"]+)"/;
  const current = entry.exec(lock);
  const previous = entry.exec(baseline);
  return {
    version: current?.[1],
    checksum: current?.[2],
    onlyRustlsChanged: Boolean(current && previous)
      && lock.replace(entry, '<rustls>') === baseline.replace(entry, '<rustls>'),
    manifestUnchanged: manifest === baselineManifest,
  };
}
// @ts-expect-error augur-inject
inspectRustlsLock = contract(inspectRustlsLock, { ...augurContract_7f9c4931, contractId: 'C-3', mode: 'observe', sample: 1, where: 'contracts/rustls-lock.mjs:2', rule: 'contract-wrap', id: '7f9c4931' }); /* augur-inject:contract-wrap:7f9c4931 */
