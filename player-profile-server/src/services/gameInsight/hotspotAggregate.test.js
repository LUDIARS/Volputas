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
