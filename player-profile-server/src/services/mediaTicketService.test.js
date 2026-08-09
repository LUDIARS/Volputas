const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LOCAL_SUBJECT,
  OWNER_SUBJECT,
  issueMediaTicket,
  verifyMediaTicket,
} = require('./mediaTicketService');

const KIND = 'videos';
const RECORD_ID = '9a5c8f52-1d3e-4b6a-8c7d-0e1f2a3b4c5d';

test('a ticket round-trips with its subject type', async () => {
  const ticket = await issueMediaTicket({
    userId: 'local-1',
    kind: KIND,
    recordId: RECORD_ID,
  });

  const claims = await verifyMediaTicket(ticket);
  assert.equal(claims.sub, 'local-1');
  assert.equal(claims.subjectType, LOCAL_SUBJECT);
});

test('a GLAB ticket is refused by the local playback route and vice versa', async () => {
  const ownerTicket = await issueMediaTicket({
    userId: 'cernere-1',
    kind: KIND,
    recordId: RECORD_ID,
    subjectType: OWNER_SUBJECT,
  });
  const localTicket = await issueMediaTicket({
    userId: 'local-1',
    kind: KIND,
    recordId: RECORD_ID,
  });

  // 取り違えると「別人の id を所有者として解決する」ことになる。 券面の
  // subjectType がその取り違えを機械的に止める。
  await assert.rejects(
    () => verifyMediaTicket(ownerTicket),
    (error) => error.code === 'INVALID_MEDIA_TICKET',
  );
  await assert.rejects(
    () => verifyMediaTicket(localTicket, { subjectType: OWNER_SUBJECT }),
    (error) => error.code === 'INVALID_MEDIA_TICKET',
  );

  const claims = await verifyMediaTicket(ownerTicket, { subjectType: OWNER_SUBJECT });
  assert.equal(claims.sub, 'cernere-1');
});

test('an attacker-controlled unknown key id is an invalid ticket, not a server error', async () => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = [
    encode({ alg: 'RS256', typ: 'JWT', kid: 'unknown-attacker-key' }),
    encode({ sub: 'cernere-1', kind: KIND, recordId: RECORD_ID }),
    'invalid-signature',
  ].join('.');

  await assert.rejects(
    () => verifyMediaTicket(token, { subjectType: OWNER_SUBJECT }),
    (error) => error.code === 'INVALID_MEDIA_TICKET',
  );
});
