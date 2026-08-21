// Deterministic cut of an LLM answer into the two lens judgments and the
// synthesis (spec/feature/emotion-judgment-lenses.md §構造化). Pure text
// work: the headings come from judgmentLenses.js, nothing is re-derived and a
// missing heading yields `null` for that part rather than a guess.
const {
  AGREEMENT_LEVELS,
  AGREEMENT_LINE_PREFIX,
  LENSES,
  LENS_IDS,
  SYNTHESIS_HEADING,
} = require('./judgmentLenses');

const JUDGMENTS_SCHEMA_VERSION = 1;

function normalizeHeading(line) {
  return String(line).trim().replace(/^#+\s*/, '').replace(/\s+/g, '')
    .replace(/^\*+|\*+$/g, '')
    .replace(/[（）]/g, (ch) => (ch === '（' ? '(' : ')'));
}

function headingKey(heading) {
  return normalizeHeading(heading);
}

// Accepts "## 西洋の判定 (機序)" as well as "### 西洋の判定（機序）" or a bold
// "**西洋の判定 (機序)**" — the model does not always keep the exact level.
/** @implements SPEC-EMOTION-JUDGMENT-LENSES */
function matchesHeading(line, heading) {
  return normalizeHeading(line) === headingKey(heading);
}

// Every heading this module recognises, so a section always ends where the
// next one begins. Keeping this in sync with `matchesHeading` matters: a
// heading shape that `matchesHeading` accepts but this misses would let one
// judgment swallow the next (e.g. "##東洋の判定 (全体観)" with no space after
// the hashes, which `/^#{1,6}\s/` alone does not see).
const KNOWN_HEADING_KEYS = new Set(
  [...LENS_IDS.map((id) => LENSES[id].heading), SYNTHESIS_HEADING].map(headingKey)
);

function isSectionBoundary(line) {
  const trimmed = line.trim();
  return /^#{1,6}(\s|$)/.test(trimmed)
    || /^\*\*.+\*\*$/.test(trimmed)
    || KNOWN_HEADING_KEYS.has(normalizeHeading(trimmed));
}

function sectionBounds(lines, heading) {
  const start = lines.findIndex((line) => matchesHeading(line, heading));
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (isSectionBoundary(lines[index])) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function sectionBody(lines, bounds) {
  return lines.slice(bounds.start + 1, bounds.end).join('\n').trim();
}

/** @implements SPEC-EMOTION-JUDGMENT-LENSES */
function parseConfidence(body) {
  const match = /確度\s*[:：]\s*(高|中|低)/.exec(body || '');
  return match ? match[1] : null;
}

// Read from the head of the synthesis (spec §構造化: 「`一致度:` は合議の行頭
// から読む」). Only the first non-empty line counts, so a 一致度 quoted later in
// the prose cannot stand in for a missing declaration.
/** @implements SPEC-EMOTION-JUDGMENT-LENSES */
function parseAgreement(body) {
  const line = (body || '').split('\n').map((item) => item.trim())
    .find((item) => item !== '');
  if (!line) return null;
  // Tolerate the full-width colon the same way `確度` does.
  const label = AGREEMENT_LINE_PREFIX.replace(/:$/, '');
  const match = new RegExp(`^[-*]?\\s*\\*{0,2}${label}\\*{0,2}\\s*[:：]\\s*(.*)$`).exec(line);
  if (!match) return null;
  const level = match[1].trim().charAt(0);
  return AGREEMENT_LEVELS.includes(level) ? level : null;
}

// `{ schemaVersion, western, eastern, synthesis, agreement, complete }` where
// each lens is `{ text, confidence }` or null, synthesis is text or null,
// agreement is 高/中/低 or null, and `complete` says all three were found.
/** @implements SPEC-EMOTION-JUDGMENT-LENSES */
function parseJudgmentSections(text) {
  const lines = String(text || '').split(/\r?\n/);
  const result = { schemaVersion: JUDGMENTS_SCHEMA_VERSION };
  for (const id of LENS_IDS) {
    const bounds = sectionBounds(lines, LENSES[id].heading);
    if (!bounds) {
      result[id] = null;
      continue;
    }
    const body = sectionBody(lines, bounds);
    result[id] = { text: body, confidence: parseConfidence(body) };
  }
  const synthesisBounds = sectionBounds(lines, SYNTHESIS_HEADING);
  const synthesis = synthesisBounds ? sectionBody(lines, synthesisBounds) : null;
  result.synthesis = synthesis;
  result.agreement = synthesis ? parseAgreement(synthesis) : null;
  result.complete = LENS_IDS.every((id) => result[id] !== null) && synthesis !== null;
  return result;
}

module.exports = { JUDGMENTS_SCHEMA_VERSION, parseJudgmentSections, parseAgreement, parseConfidence };
