const test = require('node:test');
const assert = require('node:assert/strict');
const { toAiManagementEvent, toHumanManagementEvent } = require('./managementEventPayload.mjs');

const playedAt = '2026-11-21T00:00:00.000Z';
const aiReview = {
  id: 'aipt_test',
  run_id: 'run-example',
  game_id: 'KD',
  game_title: 'Game Title',
  summary: 'Improves with practice. email: reviewer@example.test',
  good: [{ text: 'Clear controls', evidence: { shots: [123] } }],
  bad: [{ text: 'Slow scrolling; user_id=private-user' }],
  confusions: [{ text: 'Which menu? See https://private.example/record' }],
  reflection: ['Do not forward reflection'],
  persona: 'Do not forward persona',
  played_at: playedAt,
};

test('AI event includes useful highlights and projects only approved data', () => {
  const event = toAiManagementEvent(aiReview);
  assert.deepEqual(event, {
    event_key: 'vo:ai-playtest:run-example',
    source: 'vo',
    kind: 'ai-playtest-review',
    project_code: 'KD',
    target_key: 'game/KD',
    origin: 'ai',
    summary: 'Game Title\nImproves with practice. [識別情報]\n良い点 Clear controls\n悪い点 Slow scrolling; [識別情報]\n迷った点 Which menu? See [URL]',
    observed_at: Date.parse(playedAt),
  });
});

test('AI events remain valid for long or non-ASCII IDs and preserve each highlight category', () => {
  const points = Array.from({ length: 8 }, () => ({ text: 'a🎮'.repeat(100) }));
  const review = {
    ...aiReview,
    run_id: '例'.repeat(200),
    game_id: 'ゲーム甲',
    game_title: 't'.repeat(200),
    summary: 's'.repeat(400),
    good: points,
    bad: points,
    confusions: points,
    played_at: null,
    created_at: playedAt,
  };
  const event = toAiManagementEvent(review);
  assert.deepEqual(toAiManagementEvent(review), event);
  assert.notEqual(toAiManagementEvent({ ...review, game_id: 'ゲーム乙' }).project_code, event.project_code);
  assert.match(event.event_key, /^vo:ai-playtest:sha256\/[0-9a-f]{64}$/);
  assert.match(event.project_code, /^game-[0-9a-f]{32}$/);
  assert.equal(event.target_key, `game/${event.project_code}`);
  assert.equal(event.observed_at, Date.parse(playedAt));
  assert.ok(event.summary.length <= 2000 && event.summary.isWellFormed());
  assert.match(event.summary, /良い点.*悪い点.*迷った点/s);
});

test('human event exposes only its receipt and game routing metadata', () => {
  const id = '8a35ee64-c023-4735-aeac-15ea357d3209';
  assert.deepEqual(toHumanManagementEvent({
    id, game_id: 'KD', captured_at: playedAt, body: 'My contact details',
    user_id: 'private-user', session_id: 'private-session', email: 'private@example.test',
  }), {
    event_key: `vo:play-impression:${id}`,
    source: 'vo',
    kind: 'play-impression',
    project_code: 'KD',
    target_key: 'game/KD',
    origin: 'human',
    summary: 'プレイ感想が保存されました。',
    observed_at: Date.parse(playedAt),
  });
});
