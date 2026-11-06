// Records standard compiler output without loading the imported SDK.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../vendor/cernere-composite/', import.meta.url);
const hashes = {};
for (const name of readdirSync(new URL('dist/', root)).sort()) {
  if (!/^[a-z-]+\.(?:js|d\.ts)$/.test(name)) throw new Error('Unexpected Composite compiler output');
  hashes[name] = createHash('sha256').update(readFileSync(new URL('dist/' + name, root))).digest('hex');
}
if (Object.keys(hashes).length !== 16) throw new Error('Expected the complete eight-file backend graph');
writeFileSync(new URL('artifact-pin.json', root), JSON.stringify({ compiler: 'typescript@5.9.3',
  sourceRevision: JSON.parse(readFileSync(new URL('source-pin.json', root), 'utf8')).revision, hashes }, null, 2) + '\n');
