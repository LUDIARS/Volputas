const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { createGlabDelegation, createGlabComposite, VOLUPTAS_PROJECT_KEY } = require('./glabDelegation');

const TOKEN = 'a'.repeat(43), REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const USER = { id: 'owner', displayName: 'Owner', email: null, role: 'general' };
function request(body, scheme = 'Cernere-Delegation') {
  const req = Readable.from([Buffer.from(body)]);
  const authorization = `${scheme} ${TOKEN}`;
  Object.assign(req, { method: 'POST', originalUrl: '/api/v1/integrations/glab/evidence/emotion-curves',
    headers: { authorization, 'x-cernere-request-id': REQUEST_ID, 'content-type': 'application/json' },
    rawHeaders: ['Authorization', authorization, 'X-Cernere-Request-Id', REQUEST_ID, 'Content-Type', 'application/json'] });
  const res = new EventEmitter(); res.writableEnded = false;
  return { req, res };
}
async function client(call) {
  const { CompositeDelegations } = await import('../../../vendor/cernere-composite/dist/delegation.js');
  const { CompositeUploads } = await import('../../../vendor/cernere-composite/dist/upload.js');
  return { delegations: new CompositeDelegations(call, 'voluptas'), uploads: new CompositeUploads(call, 'voluptas') };
}
const decision = operation => ({ allowed: true, projectKey: 'voluptas', sourceProject: 'glab', user: USER,
  requestId: operation.requestId, risk: 'important', expiresAt: new Date(Date.now() + 4_000).toISOString() });

test('exact raw body/path reaches the SDK; owner ACL precedes execution', async () => {
  const bytes = '{"name":"日本語"}', events = [];
  const boundary = createGlabDelegation({ composite: () => client(async (action, operation) => {
    assert.equal(action, 'consume-delegation');
    assert.equal(operation.contentDigest, createHash('sha256').update(bytes).digest('base64url'));
    assert.equal(operation.path, '/api/v1/integrations/glab/evidence/emotion-curves');
    events.push('consume'); return decision(operation);
  }) });
  const { req, res } = request(bytes);
  const result = await boundary.run(req, res, { action: 'evidence.curves.create', risk: 'important',
    authorizeResource: current => { assert.equal(current.user.id, USER.id); events.push('acl'); return true; },
    execute: body => { assert.equal(body.toString(), bytes); events.push('execute'); return 'saved'; },
  });
  assert.equal(result, 'saved'); assert.deepEqual(events, ['consume', 'acl', 'execute']);
  assert.equal(req.listenerCount('aborted'), 0); assert.equal(res.listenerCount('close'), 0);
});

for (const rejected of ['source', 'authority', 'acl', 'retired-project']) test(`denied${rejected} never executes or falls back`, async () => {
  const boundary = createGlabDelegation({ composite: () => client(async (_action, operation) => {
    if (rejected === 'authority') throw new Error('private-authority-detail');
    return { ...decision(operation), sourceProject: rejected === 'source' ? 'other-project' : 'glab',
      projectKey: rejected === 'retired-project' ? 'volputas' : 'voluptas' };
  }) });
  const { req, res } = request('{}');
  await assert.rejects(boundary.run(req, res, { action: 'evidence.curves.create', risk: 'important',
    authorizeResource: () => rejected !== 'acl', execute: () => assert.fail('Must not execute'),
  }), error => error.statusCode === 503 && !error.message.includes('private-authority-detail'));
});

for (const authProject of ['voluptas', 'volputas']) test(`backend SDK authenticates the registered identity and rejects the retired one (${authProject})`, async t => {
  let checked = 0;
  const expiresAt = new Date(Date.now() + 240_000).toISOString();
  const grant = { projectToken: 'scoped', sessionBinding: 'b'.repeat(43), projectKey: 'voluptas', user: USER, expiresAt };
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, 'https://authority.example');
    if (url.pathname === '/api/auth/login') {
      assert.deepEqual(JSON.parse(init.body), { grant_type: 'project_credentials', client_id: 'fixture-client', client_secret: 'fixture-only-secret' });
      return Response.json({ tokenType: 'project', accessToken: 'project-credential', expiresIn: 300, project: { key: authProject } });
    }
    assert.equal(url.pathname, '/api/auth/service/check'); checked++;
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer project-credential');
    return Response.json(grant);
  });
  const sdk = await createGlabComposite({ baseUrl: 'https://authority.example', projectClientId: 'fixture-client', projectClientSecret: 'fixture-only-secret' });
  try {
    if (authProject === 'voluptas') {
      assert.equal((await sdk.sessions.check(grant)).projectKey, 'voluptas'); assert.equal(checked, 1);
    } else {
      await assert.rejects(sdk.sessions.check(grant), /Invalid project credential response/); assert.equal(checked, 0);
    }
  } finally { sdk.dispose(); }
  assert.equal(VOLUPTAS_PROJECT_KEY, 'voluptas');
});

test('a database failure after execution starts is not mislabeled as an authorization outage', async () => {
  const boundary = createGlabDelegation({ composite: () => client(async (_action, operation) => decision(operation)) });
  const { req, res } = request('{}');
  const failure = new Error('database outcome unknown');
  await assert.rejects(boundary.run(req, res, { action: 'evidence.curves.create', risk: 'important',
    authorizeResource: () => true, execute: () => { throw failure; },
  }), error => error === failure);
});

test('changed captured upload bytes fail before finalize and release the capture', async () => {
  const actions = []; let disposed = false;
  const expiresAt = new Date(Date.now() + 4_000).toISOString();
  const boundary = createGlabDelegation({ composite: () => client(async (action, operation) => {
    actions.push(action);
    if (action === 'begin-upload') return { requestId: REQUEST_ID, receipt: 'r'.repeat(43), risk: 'important', expiresAt,
      limits: { maximumBytes: 20, timeoutSeconds: 5 }, byteLength: 5,
      contentDigest: createHash('sha256').update('right').digest('base64url') };
    if (action === 'cancel-upload') return {};
    assert.fail('Must not finalize changed body');
  }), spool: { capture: async () => ({ body: new Blob(['wrong']), dispose: async () => { disposed = true; } }) } });
  const { req, res } = request('wrong', 'Cernere-Upload'); req.method = 'PUT';
  req.originalUrl = '/api/v1/integrations/glab/evidence/media/videos/record';
  await assert.rejects(boundary.upload(req, res, { limits: { maximumBytes: 20, timeoutSeconds: 5 },
    authorizeResource: () => assert.fail('Must not authorize'), execute: () => assert.fail('Must not execute'),
  }), error => error.statusCode === 503);
  assert.equal(disposed, true); assert.deepEqual(actions, ['begin-upload', 'cancel-upload']);
  assert.equal(req.listenerCount('aborted'), 0); assert.equal(res.listenerCount('close'), 0);
});
