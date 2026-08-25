const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DiscutereDiscussionPublisher,
  discuterePersonaId,
} = require('./discutereDiscussionPublisher');

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const PERSONA = {
  pseudoId: 'ext:voluptas:0123456789abcdef',
  affectVector: Array(20).fill(0.5),
  vectorSpecVersion: 1,
  exportSpecVersion: 2,
};

test('derives the canonical Discutere persona id from the Voluptas pseudonym', () => {
  assert.equal(
    discuterePersonaId(PERSONA.pseudoId),
    'persona:voluptas:bb70a0352885a3b0'
  );
  assert.throws(() => discuterePersonaId('raw-user-id'), /pseudoId/);
});

test('imports the persona before starting a discussion with that persona selected', async () => {
  const calls = [];
  const publisher = new DiscutereDiscussionPublisher({
    baseUrl: 'http://127.0.0.1:3000/',
    token: 'x'.repeat(32),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options, body: JSON.parse(options.body) });
      const payload = calls.length === 1
        ? { ok: true, imported: 1, skipped: 0 }
        : { ok: true, sessionId: SESSION_ID, review: true };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const result = await publisher.publish({
    persona: PERSONA,
    review: { gameTitle: 'Game', rating: 4, text: '探索が楽しかった。' },
  });

  assert.deepEqual(result, { sessionId: SESSION_ID, reviewRequired: true });
  assert.equal(calls[0].url, 'http://127.0.0.1:3000/api/admin/personas/import');
  assert.deepEqual(calls[0].body, { personas: [PERSONA] });
  assert.equal(calls[1].url, 'http://127.0.0.1:3000/api/flow/start');
  assert.deepEqual(calls[1].body.personaIds, [discuterePersonaId(PERSONA.pseudoId)]);
  assert.match(calls[1].body.discussionContent, /探索が楽しかった/);
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${'x'.repeat(32)}`);
});

test('does not start a discussion when persona import is skipped', async () => {
  let calls = 0;
  const publisher = new DiscutereDiscussionPublisher({
    baseUrl: 'http://127.0.0.1:3000/',
    token: 'x'.repeat(32),
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: true, imported: 0, skipped: 1 }), { status: 200 });
    },
  });
  await assert.rejects(
    () => publisher.publish({ persona: PERSONA, review: { gameTitle: 'Game', rating: 4, text: 'text' } }),
    { code: 'DISCUTERE_PERSONA_IMPORT_REJECTED', statusCode: 502 }
  );
  assert.equal(calls, 1);
});

test('fails closed when the shared bridge credential is too short', async () => {
  const publisher = new DiscutereDiscussionPublisher({
    baseUrl: 'http://127.0.0.1:3000/',
    token: 'short',
    fetchImpl: async () => assert.fail('fetch must not run'),
  });
  await assert.rejects(
    () => publisher.publish({ persona: PERSONA, review: { gameTitle: 'Game', rating: 4, text: 'text' } }),
    { code: 'DISCUTERE_DISCUSSION_UNAVAILABLE', statusCode: 503 }
  );
});
