const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateHotspots } = require('./hotspotAggregate');

// 600 s reference; 20 bins of 30 s each.
function video(id, entries, playtimeMinutes = 10) {
  return { id, mode: 'video', gameTitle: 'Hot Quest', sessionPlaytimeMinutes: playtimeMinutes, entries };
}
const calm = (timeSeconds) => ({ timeSeconds, valence: 0.5, arousal: 2 });

test('rejects fewer than two sessions', () => {
  assert.throws(
    () => aggregateHotspots([{ playerKey: 'p1', record: video('a', [calm(10)]) }]),
    (error) => error.code === 'GAME_INSIGHT_INSUFFICIENT_SESSIONS' && error.statusCode === 409
  );
});

test('players vote once per bin and shared arousal spikes become hype hotspots', () => {
  const items = [
    // Player 1 plays three times, always calm except a spike near 50%.
    ...['a1', 'a2', 'a3'].map((id) => ({
      playerKey: 'p1',
      record: video(id, [calm(30), calm(150), { timeSeconds: 300, valence: 2, arousal: 5, stamp: 'hype', comment: 'ボス登場' }, calm(450), calm(570)]),
    })),
    { playerKey: 'p2', record: video('b', [calm(30), calm(150), { timeSeconds: 300, valence: 1.5, arousal: 5, stamp: 'hype' }, calm(450), calm(570)]) },
    { playerKey: 'p3', record: video('c', [calm(30), calm(150), calm(300), calm(450), calm(570)]) },
  ];
  const analysis = aggregateHotspots(items);
  assert.equal(analysis.playerCount, 3);
  assert.equal(analysis.sessionCount, 5);
  assert.equal(analysis.singlePlayer, false);
  assert.equal(analysis.referenceLengthSeconds, 600);
  const middle = analysis.bins[10];
  // Player-weighted: (5 + 5 + 2) / 3, not dominated by p1's three sessions.
  assert.ok(Math.abs(middle.arousal - 4) < 0.3, `arousal ${middle.arousal}`);
  assert.equal(middle.playerCoverage, 3);
  assert.deepEqual(middle.stampPlayers, { hype: 2 });
  const hype = analysis.hotspots.find((spot) => spot.kind === 'hype');
  assert.ok(hype, 'expected a hype hotspot');
  assert.ok([9, 10].includes(hype.bin), `bin ${hype.bin}`);
  assert.equal(hype.playerCount, 3);
  assert.ok(hype.reasons.includes('arousal-spike'));
  assert.equal(hype.quotes[0].comment, 'ボス登場');
  assert.equal(hype.quotes[0].player, 'P1');
  assert.equal(analysis.players.length, 3);
  assert.deepEqual(analysis.players[0].recordIds, ['a1', 'a2', 'a3']);
});

test('negative stamps from a majority of players mark a pain spot and early endings become dropouts', () => {
  const items = [
    { playerKey: 'p1', record: video('a', [calm(30), { timeSeconds: 120, valence: -2, arousal: 4, stamp: 'stress', comment: '操作が分からない' }], 2.5) },
    { playerKey: 'p2', record: video('b', [calm(30), { timeSeconds: 125, valence: -1.5, arousal: 4, stamp: 'dislike' }], 2.5) },
    { playerKey: 'p3', record: video('c', [calm(30), calm(120), calm(300), calm(590)], 10) },
  ];
  const analysis = aggregateHotspots(items);
  const pain = analysis.hotspots.find((spot) => spot.reasons.includes('negative-stamps'));
  assert.ok(pain, 'expected a stamp-based pain hotspot');
  assert.equal(pain.kind, 'pain');
  assert.equal(pain.bin, 4);
  assert.deepEqual(pain.stampPlayers, { stress: 1, dislike: 1 });
  assert.equal(analysis.dropouts[0].sessionCount, 2);
  assert.equal(analysis.dropouts[0].playerCount, 2);
  assert.ok(analysis.dropouts[0].exitValence < 0);
  assert.equal(analysis.completion.sessionCount, 1);
  assert.equal(analysis.survival[19], Number((1 / 3).toFixed(4)));
});

test('a single player is aggregated but flagged', () => {
  const analysis = aggregateHotspots([
    { playerKey: 'solo', record: video('a', [calm(30), { timeSeconds: 300, valence: 2, arousal: 5 }, calm(570)]) },
    { playerKey: 'solo', record: video('b', [calm(30), { timeSeconds: 300, valence: 2, arousal: 5 }, calm(570)]) },
  ]);
  assert.equal(analysis.singlePlayer, true);
  assert.equal(analysis.playerCount, 1);
  assert.ok(analysis.hotspots.length >= 1);
  assert.equal(analysis.hotspots[0].playerCount, 1);
});

test('unknown imported stamp keys do not enter aggregate objects', () => {
  const analysis = aggregateHotspots([
    { playerKey: 'p1', record: video('a', [{ timeSeconds: 30, valence: 0, arousal: 3, stamp: '__proto__' }]) },
    { playerKey: 'p2', record: video('b', [{ timeSeconds: 30, valence: 0, arousal: 3, stamp: 'constructor' }]) },
  ]);
  assert.deepEqual(analysis.bins.at(-1).stampPlayers, {});
  assert.equal(Object.getPrototypeOf(analysis.bins.at(-1).stampPlayers), Object.prototype);
});

test('ordinal first: a quiet player\'s own peak counts as much as a loud player\'s, and the bins expose z values', () => {
  const quietCalm = (timeSeconds) => ({ timeSeconds, valence: 0, arousal: 1 });
  const loudCalm = (timeSeconds) => ({ timeSeconds, valence: 1, arousal: 4 });
  const items = [
    // Loud recorder: always 4, peaks at 5 near 50%.
    { playerKey: 'loud', record: video('l', [loudCalm(30), loudCalm(150), { timeSeconds: 300, valence: 1, arousal: 5 }, loudCalm(450), loudCalm(570)]) },
    // Quiet recorder: always 1, peaks at 2 near 50% — same moment, smaller raw step.
    { playerKey: 'quiet', record: video('q', [quietCalm(30), quietCalm(150), { timeSeconds: 300, valence: 0, arousal: 2 }, quietCalm(450), quietCalm(570)]) },
  ];
  const analysis = aggregateHotspots(items);
  const middle = analysis.bins[10];
  assert.ok(Number.isFinite(middle.arousalZ), 'bins carry a within-player z');
  assert.ok(middle.arousalZ > 0, `arousalZ ${middle.arousalZ}`);
  assert.ok(Number.isFinite(middle.valenceZ));
  assert.ok(middle.agreementOrdinal !== null);
  const hype = analysis.hotspots.find((spot) => spot.kind === 'hype');
  assert.ok(hype, 'shared above-usual moment is a hotspot');
  assert.equal(hype.detectionBasis, 'ordinal');
  assert.equal(hype.playerCount, 2);
  assert.ok([9, 10].includes(hype.bin), `bin ${hype.bin}`);
  assert.equal(typeof hype.valenceZ, 'number');
  // The z pair a spot carries is the within-player one of its own bin (what the
  // UI labels 「各自の普段との差」); the spike strength lives under spikeZ.
  const hypeBin = analysis.bins[hype.bin];
  assert.equal(hype.valenceZ, hypeBin.valenceZ);
  assert.equal(hype.arousalZ, hypeBin.arousalZ);
  assert.ok(Number.isFinite(hype.spikeZ), `spikeZ ${hype.spikeZ}`);
});

test('a perfectly flat ordinal series falls back to the raw arousal instead of hiding every spike', () => {
  // Both recorders answer the same arousal in every covered bin except one
  // shared peak, and each has a single session, so their own baseline is built
  // from the very bins being scored. Whenever the within-player z collapses to
  // all-zero, detection must not silently go blind.
  const flat = (timeSeconds, arousal) => ({ timeSeconds, valence: 0.5, arousal });
  const items = [
    { playerKey: 'p1', record: video('a', [flat(300, 3), flat(300, 3)]) },
    { playerKey: 'p2', record: video('b', [flat(300, 3), flat(300, 3)]) },
  ];
  const analysis = aggregateHotspots(items);
  // A flat player yields z 0 everywhere; the basis must degrade to 'raw'.
  const bases = new Set(analysis.hotspots.map((spot) => spot.detectionBasis));
  assert.ok(!bases.has('ordinal'), `flat ordinal must not claim ordinal detection: ${[...bases]}`);
  // Every reported hotspot must carry a real score, never a null-arousal 0.
  for (const spot of analysis.hotspots) {
    assert.ok(Number.isFinite(spot.arousal), `hotspot ${spot.bin} has null arousal`);
    assert.ok(Number.isFinite(spot.score), `hotspot ${spot.bin} has a non-finite score`);
  }
});

test('a moment clearly below a player\'s usual is pain even when the raw valence stays positive', () => {
  const happy = (timeSeconds) => ({ timeSeconds, valence: 2, arousal: 2 });
  const items = [
    { playerKey: 'p1', record: video('a', [happy(30), happy(150), { timeSeconds: 300, valence: 0.5, arousal: 5 }, happy(450), happy(570)]) },
    { playerKey: 'p2', record: video('b', [happy(30), happy(150), { timeSeconds: 300, valence: 0.5, arousal: 5 }, happy(450), happy(570)]) },
  ];
  const analysis = aggregateHotspots(items);
  const spot = analysis.hotspots.find((item) => [9, 10].includes(item.bin));
  assert.ok(spot, 'expected a hotspot at the dip');
  assert.ok(spot.valence > 0, `raw valence ${spot.valence}`);
  assert.ok(spot.valenceZ <= -1, `valenceZ ${spot.valenceZ}`);
  assert.equal(spot.kind, 'pain');
});
