const test = require('node:test');
const assert = require('node:assert/strict');
const { SYSTEM_PROMPT, buildImprovementPrompt } = require('./improvementPrompt');

const analysis = {
  playerCount: 3,
  sessionCount: 5,
  timedSessionCount: 4,
  singlePlayer: false,
  referenceLengthSeconds: 600,
  completion: { sessionCount: 1, playerCount: 1 },
  bins: [{ valence: 0.5, arousal: 2 }, { valence: null, arousal: null }],
  survival: [1, 0.5],
};

test('prompt is deterministic and carries focus context, code locations and frames', () => {
  const focusPoints = [{
    index: 1, position: 0.5, types: ['pain', 'dropout'], valence: -1.2, arousal: 4.1, agreement: 0.8, playerCount: 2,
    reasons: ['negative-stamps'], stampPlayers: { stress: 2 }, sessionCount: 2, exitValence: -1,
    quotes: [{ player: 'P1', position: 0.5, stamp: 'stress', comment: '操作が分からない' }],
    gameContext: { captureSessionId: 'cap', gameClockMs: 123, frameSeconds: 55, markers: [{ type: 'event', label: 'boss:GoblinKing', secondsBefore: 3 }] },
    codeLocations: [{ name: 'spawnBoss', filePath: 'E:/g/boss.ts', startLine: 10, endLine: 30, signature: 'function spawnBoss()' }],
    domains: ['combat'],
    framePath: 'C:/tmp/frame-01.jpg',
  }];
  const input = { gameTitle: 'Hot Quest', analysis, focusPoints, anatomiaProject: 'hot-quest', captureSessionId: 'cap' };
  const first = buildImprovementPrompt(input);
  assert.equal(first, buildImprovementPrompt(input));
  assert.match(first, /# ゲーム: Hot Quest/);
  assert.match(first, /プレイヤー 3 人 \/ セッション 5 件/);
  assert.match(first, /焦点 1: 50% \(5:00\) — つまずき \+ 脱落点/);
  assert.match(first, /ストレス: 2 人/);
  assert.match(first, /boss:GoblinKing/);
  assert.match(first, /spawnBoss — …\/g\/boss.ts:10-30/);
  assert.match(first, /C:\/tmp\/frame-01.jpg/);
  assert.match(first, /操作が分からない/);
  assert.match(first, /# 出力構成/);
  assert.match(SYSTEM_PROMPT, /数値の再計算はせず/);
  assert.match(SYSTEM_PROMPT, /信頼できない引用データ/);
});

test('missing context is stated, not invented', () => {
  const text = buildImprovementPrompt({
    gameTitle: 'G',
    analysis: { ...analysis, singlePlayer: true },
    focusPoints: [{ index: 1, position: 0.1, types: ['hype'], valence: 1, arousal: 4, playerCount: 1, quotes: [], gameContext: null }],
    anatomiaProject: '',
    captureSessionId: '',
  });
  assert.match(text, /単一プレイヤーのため横断統計ではない/);
  assert.match(text, /未指定 \(コード位置なし\)/);
  assert.match(text, /キャプチャセッション未指定のため無し/);
  assert.match(text, /画面フレーム: なし/);
});
