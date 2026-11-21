const test = require('node:test');
const assert = require('node:assert/strict');
const { managementEventsUrl } = require('./managementEvents');
const { startManagementEventDelivery } = require('../services/managementEvents/startManagementEventDelivery');

test('explicit endpoint wins, then the base origin supplies the fixed path', () => {
  const env = { CONCORDIA_URL: 'http://localhost:11111/some-path' };
  assert.equal(managementEventsUrl(env, {}), 'http://localhost:11111/v1/management/events');
  env.CONCORDIA_MANAGEMENT_EVENTS_URL = 'https://events.example/explicit';
  assert.equal(managementEventsUrl(env, {}), 'https://events.example/explicit');
});

test('disabled, HASTER and local settings do not schedule an initial push', () => {
  const unusedStart = () => assert.fail('disabled workers must not start');
  const url = 'http://127.0.0.1:11111';
  const cases = [
    [{}, {}],
    [{ CONCORDIA_MANAGEMENT_EVENTS_URL: ' Off ', CONCORDIA_URL: url }, {}],
    [{ CONCORDIA_URL: 'off' }, {}],
    [{ CONCORDIA_MANAGEMENT_EVENTS_URL: 'bad URL' }, { hasterEnabled: true }],
    [{ CONCORDIA_URL: url }, { localMode: true }],
  ];
  for (const [env, mode] of cases) {
    assert.equal(startManagementEventDelivery({ url: managementEventsUrl(env, mode), startPush: unusedStart }), null);
  }
});

test('invalid explicit endpoint cannot fall back to the base URL', () => {
  assert.throws(() => managementEventsUrl({
    CONCORDIA_MANAGEMENT_EVENTS_URL: 'https://user@example.test/path',
    CONCORDIA_URL: 'https://example.test',
  }, {}), /must not contain credentials/);
});
