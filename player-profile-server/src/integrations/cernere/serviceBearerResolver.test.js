const test = require('node:test');
const assert = require('node:assert/strict');
const { createServiceBearerResolver } = require('./serviceBearerResolver');
const { ServiceTokenIssueError } = require('./serviceTokenClient');

function failingClient(reason) {
  return {
    getToken: async () => {
      throw new ServiceTokenIssueError(reason);
    },
  };
}

test('prefers the Cernere service token over the legacy fixed token', async () => {
  const resolve = createServiceBearerResolver({
    tokenClient: { getToken: async () => 'v4.public.service' },
    fallbackToken: 'legacy-fixed-token',
    label: 'test',
    warn: () => assert.fail('must not warn when issuance succeeds'),
  });
  assert.equal(await resolve(), 'v4.public.service');
});

test('falls back to the legacy token only on issuance failure and logs the reason code without secrets', async () => {
  const warnings = [];
  const resolve = createServiceBearerResolver({
    tokenClient: failingClient('scope_undeclared'),
    fallbackToken: 'legacy-fixed-token',
    label: 'discutere-persona-bridge',
    warn: (line) => warnings.push(line),
  });
  assert.equal(await resolve(), 'legacy-fixed-token');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /reason=scope_undeclared/);
  assert.doesNotMatch(warnings[0], /legacy-fixed-token/);
});

test('propagates issuance failure when no legacy token is configured', async () => {
  const resolve = createServiceBearerResolver({
    tokenClient: failingClient('not_configured'),
    fallbackToken: '',
    label: 'test',
    warn: () => {},
  });
  await assert.rejects(resolve(), { reason: 'not_configured' });
});

test('does not mask unexpected errors with the legacy token', async () => {
  const resolve = createServiceBearerResolver({
    tokenClient: { getToken: async () => { throw new RangeError('bug'); } },
    fallbackToken: 'legacy-fixed-token',
    label: 'test',
    warn: () => {},
  });
  await assert.rejects(resolve(), RangeError);
});
