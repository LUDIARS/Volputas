// Generates the static mechanic suggestion dictionary
// (frontend/src/data/ludus-lexicon.json) from the Ludus central lexicon
// (design §3.5: build-time bundle; Voluptas-side additions go in the optional
// overlay file frontend/src/data/ludus-lexicon.local.json, merged at load).
//
// Deliberately dependency-free: only the flat top-of-file keys (id, name_ja,
// name_en) are read from each feature TOML, so a full TOML parser is not
// needed for generation.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SOURCE = path.resolve(
  __dirname,
  '../../../Ludus/spec/data/game-lexicon/features'
);
const OUTPUT = path.resolve(__dirname, '../frontend/src/data/ludus-lexicon.json');

function readTopLevelString(content, key) {
  const match = content.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return match ? match[1] : '';
}

function buildLexicon(sourceDirectory) {
  if (!fs.existsSync(sourceDirectory)) {
    throw new Error(`Ludus lexicon source not found: ${sourceDirectory}`);
  }
  const mechanics = [];
  for (const category of fs.readdirSync(sourceDirectory).sort()) {
    const categoryDirectory = path.join(sourceDirectory, category);
    if (!fs.statSync(categoryDirectory).isDirectory()) continue;
    for (const file of fs.readdirSync(categoryDirectory).sort()) {
      if (!file.endsWith('.toml')) continue;
      const content = fs.readFileSync(path.join(categoryDirectory, file), 'utf8');
      const id = readTopLevelString(content, 'id') || path.basename(file, '.toml');
      mechanics.push({
        id: `${category}/${id}`,
        nameJa: readTopLevelString(content, 'name_ja') || id,
        nameEn: readTopLevelString(content, 'name_en') || id,
      });
    }
  }
  return { generatedFrom: 'Ludus/spec/data/game-lexicon/features', mechanics };
}

if (require.main === module) {
  const source = process.argv[2] || DEFAULT_SOURCE;
  const lexicon = buildLexicon(source);
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(lexicon, null, 2)}\n`, 'utf8');
  process.stdout.write(`ludus-lexicon.json: ${lexicon.mechanics.length} mechanics\n`);
}

module.exports = { buildLexicon };
