const test = require('node:test');
const assert = require('node:assert/strict');
const { TOTAL_WEIGHT, steamContributions } = require('./steamContributions');
const { analyzePersonaV2 } = require('./analyzePersonaV2');

const ANALYZED_AT = '2026-07-28T12:00:00.000Z';
const FRESH = '2026-07-20T00:00:00.000Z';
const STALE = '2026-03-01T00:00:00.000Z';

function snapshot(fetchedAt) {
  return {
    fetchedAt,
    games: [
      { app_id: 1, name: 'Main', playtime_forever_minutes: 6000, playtime_2weeks_minutes: 300 },
      { app_id: 2, name: 'Side', playtime_forever_minutes: 2000, playtime_2weeks_minutes: 0 },
      { app_id: 3, name: 'Tried', playtime_forever_minutes: 60, playtime_2weeks_minutes: 0 },
      { app_id: 4, name: 'Backlog A', playtime_forever_minutes: 0, playtime_2weeks_minutes: 0 },
      { app_id: 5, name: 'Backlog B', playtime_forever_minutes: 0, playtime_2weeks_minutes: 0 },
      { app_id: 6, name: 'Backlog C', playtime_forever_minutes: 0, playtime_2weeks_minutes: 0 },
    ],
  };
}

test('steam features cover concentration, breadth, backlog, and recency', () => {
  const { contributions, meta } = steamContributions(snapshot(FRESH), ANALYZED_AT);
  const axes = contributions.map((item) => item.axis);
  assert.ok(axes.includes('style.mastery'));
  assert.ok(axes.includes('style.explorer'));
  assert.ok(axes.includes('style.collector'));
  assert.ok(axes.includes('style.routine_tolerance'));

  const totalWeight = contributions.reduce((sum, item) => sum + item.weight, 0);
  // Genre share is skipped without app metadata, so the sum stays below 2.5.
  assert.ok(totalWeight <= TOTAL_WEIGHT + 1e-9);

  assert.equal(meta.stale, false);
  assert.equal(meta.backlogRate, 0.5);
  assert.equal(meta.completionConfidencePenalty, true);
});

test('snapshots older than 90 days decay to a fifth of the weight', () => {
  const fresh = steamContributions(snapshot(FRESH), ANALYZED_AT);
  const stale = steamContributions(snapshot(STALE), ANALYZED_AT);
  assert.equal(stale.meta.stale, true);
  const sum = (result) => result.contributions.reduce((total, item) => total + item.weight, 0);
  assert.ok(Math.abs(sum(stale) - sum(fresh) / 5) < 1e-9);
});

test('genre features activate only with app metadata', () => {
  const withoutMeta = steamContributions(snapshot(FRESH), ANALYZED_AT);
  assert.ok(!withoutMeta.contributions.some((item) => item.source.field === 'genres'));

  const withMeta = steamContributions(snapshot(FRESH), ANALYZED_AT, {
    1: { genres: ['RPG'] },
    2: { genres: ['Strategy'] },
  });
  const genreAxes = withMeta.contributions
    .filter((item) => item.source.field === 'genres')
    .map((item) => item.axis);
  assert.ok(genreAxes.includes('style.narrative'));
  assert.ok(genreAxes.includes('style.mastery'));
});

test('analyzePersonaV2 merges steam evidence and demotes achiever confidence on a big backlog', () => {
  const sources = {
    surveys: [],
    gameplay: [
      // Enough completion self-report to reach high confidence…
      {
        id: 'gp-1',
        dedication: { score: 90 },
        selfRatedMastery: 5,
        completionPercent: 95,
        achievementsUnlocked: 9,
        achievementsTotal: 10,
      },
      {
        id: 'gp-2',
        dedication: { score: 80 },
        selfRatedMastery: 4,
        completionPercent: 90,
        achievementsUnlocked: 8,
        achievementsTotal: 10,
      },
    ],
    voices: [],
    emotionCurves: [],
    steam: snapshot(FRESH),
  };
  const analysis = analyzePersonaV2(sources, ANALYZED_AT);
  assert.equal(analysis.evidence.steam, 1);
  assert.equal(analysis.steam.completionConfidencePenalty, true);
  assert.equal(analysis.preferenceAxes['style.achiever'].confidenceNote, 'steam-backlog-demotion');
  assert.ok(['medium', 'low'].includes(analysis.preferenceAxes['style.achiever'].confidence));
  assert.ok(analysis.preferenceAxes['style.collector'].score > 0);

  const withoutSteam = analyzePersonaV2({ ...sources, steam: null }, ANALYZED_AT);
  assert.equal(withoutSteam.evidence.steam, 0);
  assert.equal(withoutSteam.steam, null);
});
