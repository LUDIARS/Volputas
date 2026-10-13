const test = require('node:test');
const assert = require('node:assert/strict');
const { discutereImpressionPushConfig } = require('./discutereImpressionPush');

test('impression push runs by default every 15 minutes', () => {
  assert.deepEqual(discutereImpressionPushConfig({}), { enabled: true, intervalMinutes: 15 });
});

test('impression push stops only for the literal "false"', () => {
  assert.equal(discutereImpressionPushConfig({ DISCUTERE_IMPRESSION_PUSH_ENABLED: 'false' }).enabled, false);
  assert.equal(discutereImpressionPushConfig({ DISCUTERE_IMPRESSION_PUSH_ENABLED: '0' }).enabled, true);
});

test('impression push interval is clamped to 1..1440 minutes', () => {
  const interval = (value) => discutereImpressionPushConfig({
    DISCUTERE_IMPRESSION_PUSH_INTERVAL_MINUTES: value,
  }).intervalMinutes;
  assert.equal(interval('0'), 1);
  assert.equal(interval('5000'), 1440);
  assert.equal(interval('30'), 30);
  assert.equal(interval('not-a-number'), 15);
});
