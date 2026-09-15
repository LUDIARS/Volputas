const fs = require('node:fs');
const path = require('node:path');
const { buildHistoryPersonas } = require('../src/services/commentHistory/personas');

function main() {
  const [input, output, minimum, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) {
    throw new Error('Usage: npm run import:comment-history -- <snapshot.json> <personas.jsonl> [minimum-comments=10]');
  }
  if (path.resolve(input) === path.resolve(output)) throw new Error('Input and output must differ');
  if (fs.statSync(input).size > 100 * 1024 * 1024) throw new Error('Split history snapshots larger than 100 MiB');
  const result = buildHistoryPersonas(JSON.parse(fs.readFileSync(input, 'utf8')), {
    secret: process.env.VOLPUTAS_PSEUDO_ID_SECRET,
    youtubeApprovalReference: process.env.VOLPUTAS_YOUTUBE_DERIVED_APPROVAL_REFERENCE,
    minComments: minimum === undefined ? 10 : Number(minimum),
  });
  // Retain the private snapshot separately; public output carries no IDs, names, text, or source URLs.
  fs.writeFileSync(output, result.personas.map(row => JSON.stringify(row)).join('\n') + '\n', {
    encoding: 'utf8', flag: 'wx', mode: 0o600,
  });
  process.stdout.write(`${JSON.stringify(result.report)}\n`);
}

try { main(); }
catch (error) {
  // Schema errors may contain input snippets; do not emit raw external comments in logs.
  process.stderr.write(`${error.name === 'ZodError' ? 'Invalid comment history schema' : error.message}\n`);
  process.exitCode = 1;
}
