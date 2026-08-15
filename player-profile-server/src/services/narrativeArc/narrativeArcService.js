// Orchestrates the narrative-arc analysis for one game and one player
// (spec/feature/narrative-arc.md): selects the player's emotion curves for the
// game, runs the deterministic aggregate, persists it as a derived record with
// provenance, and (separately) asks the LLM for commentary. The two stages are
// split so the aggregate is reproducible without any LLM configured.
const { createHash } = require('node:crypto');
const { buildSessionSeries } = require('./arcSeries');
const { aggregateArc } = require('./arcAggregate');
const { SYSTEM_PROMPT, buildNarrativeArcPrompt } = require('./narrativeArcPrompt');

const ARC_EXTRACTOR = 'arc-aggregate/v1';
const ARC_SCHEMA_VERSION = 1;

function arcError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

// One record per (player, game). The id is derived from the game title so a
// re-run overwrites instead of piling up derived copies; the hash keeps the id
// a safe path segment whatever the title contains.
/** @implements SPEC-NARRATIVE-ARC */
function arcRecordId(name, gameTitle) {
  const digest = createHash('sha256').update(`${name}\n${gameTitle}`).digest('hex');
  return `arc-${digest.slice(0, 24)}`;
}

/** @implements SPEC-NARRATIVE-ARC */
function normalizeTitle(value) {
  return String(value || '').trim();
}

// Revision of exactly the source fields consumed by aggregation or the LLM
// prompt. IDs alone cannot detect an in-place human edit of an emotion curve.
/** @implements SPEC-NARRATIVE-ARC */
function sourceRevision(records) {
  const relevant = records.map((record) => ({
    id: record.id,
    mode: record.mode,
    sessionLabel: record.sessionLabel,
    createdAt: record.createdAt,
    daysAfterPlay: record.daysAfterPlay,
    totalPlaytimeHours: record.totalPlaytimeHours,
    sessionPlaytimeMinutes: record.sessionPlaytimeMinutes,
    narrativeArc: record.narrativeArc,
    entries: record.entries,
  })).sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
}

/** @implements SPEC-NARRATIVE-ARC */
class NarrativeArcService {
  constructor({ emotionCurveStore, arcStore, llmClient, now = () => new Date() }) {
    this.emotionCurveStore = emotionCurveStore;
    this.arcStore = arcStore;
    this.llmClient = llmClient;
    this.now = now;
  }

  // Same player = the local respondent name; same game = exact title match.
  // Records with another respondent (imported data) are excluded on purpose:
  // the analysis is only meaningful within one player (§前提).
  async sourceRecords(context, gameTitle) {
    const title = normalizeTitle(gameTitle);
    if (!title) throw arcError(400, 'INVALID_NARRATIVE_ARC_INPUT', 'gameTitle is required');
    const records = await this.emotionCurveStore.list(context);
    return records.filter((record) =>
      normalizeTitle(record.gameTitle) === title
      && record.respondent?.name === context.name);
  }

  async games(context) {
    const records = await this.emotionCurveStore.list(context);
    const byTitle = new Map();
    for (const record of records) {
      if (record.respondent?.name !== context.name) continue;
      const title = normalizeTitle(record.gameTitle);
      if (!title) continue;
      const entry = byTitle.get(title) || { gameTitle: title, sessionCount: 0, latestAt: null };
      entry.sessionCount += 1;
      if (!entry.latestAt || String(record.createdAt || '') > entry.latestAt) {
        entry.latestAt = record.createdAt || entry.latestAt;
      }
      byTitle.set(title, entry);
    }
    return [...byTitle.values()].sort((left, right) => right.sessionCount - left.sessionCount);
  }

  async list(context) {
    return this.arcStore.list(context);
  }

  async find(context, arcId) {
    const records = await this.arcStore.list(context);
    const record = records.find((item) => item.id === arcId);
    if (!record) throw arcError(404, 'NARRATIVE_ARC_NOT_FOUND', 'Narrative arc not found');
    return record;
  }

  async analyze(context, { gameTitle }) {
    const title = normalizeTitle(gameTitle);
    const sources = await this.sourceRecords(context, title);
    const sessions = sources.map((record) => buildSessionSeries(record));
    const analysis = aggregateArc(sessions);
    const id = arcRecordId(context.name, title);
    const existing = (await this.arcStore.list(context)).find((item) => item.id === id);
    const revision = sourceRevision(sources);
    const { record } = await this.arcStore.write({
      ...context,
      data: {
        id,
        schemaVersion: ARC_SCHEMA_VERSION,
        gameTitle: title,
        respondentName: context.name,
        sourceRecordIds: sources.map((source) => source.id).sort(),
        sourceRevision: revision,
        provenance: {
          extractor: ARC_EXTRACTOR,
          analyzedAt: this.now().toISOString(),
        },
        analysis,
        // Commentary is kept across re-analysis but flagged by its source IDs
        // and revision so the UI detects both new sessions and in-place edits.
        evaluation: existing?.evaluation ?? null,
      },
    });
    return record;
  }

  isEvaluationConfigured() {
    return this.llmClient.isConfigured();
  }

  async evaluate(context, arcId) {
    const record = await this.find(context, arcId);
    const sources = await this.sourceRecords(context, record.gameTitle);
    const currentIds = sources.map((source) => source.id).sort();
    const currentRevision = sourceRevision(sources);
    if (currentRevision !== record.sourceRevision
      || JSON.stringify(currentIds) !== JSON.stringify(record.sourceRecordIds)) {
      throw arcError(
        409,
        'NARRATIVE_ARC_STALE',
        'Source emotion curves changed; re-analyze the narrative arc before evaluation'
      );
    }
    const prompt = buildNarrativeArcPrompt({
      gameTitle: record.gameTitle,
      analysis: record.analysis,
      records: sources,
    });
    const { text, model } = await this.llmClient.generate({ system: SYSTEM_PROMPT, prompt });
    const evaluation = {
      schemaVersion: 1,
      extractor: 'llm',
      model,
      text,
      evaluatedAt: this.now().toISOString(),
      sourceRecordIds: record.sourceRecordIds,
      sourceRevision: record.sourceRevision,
    };
    const { record: persisted } = await this.arcStore.write({
      ...context,
      data: { ...record, evaluation },
    });
    return persisted;
  }
}

module.exports = {
  ARC_EXTRACTOR,
  ARC_SCHEMA_VERSION,
  NarrativeArcService,
  arcRecordId,
};
