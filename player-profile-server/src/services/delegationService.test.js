const test = require('node:test');
const assert = require('node:assert/strict');
const { createDelegationService, hashInviteToken } = require('./delegationService');

const SUBJECT = '11111111-1111-4111-8111-111111111111';
const DELEGATE = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'a'.repeat(43);

function createMemoryRepository() {
  const state = {
    grants: [],
    claims: [],
    audit: [],
    applied: [],
  };
  let grantSequence = 1;
  let claimSequence = 1;

  const repository = {
    state,
    transaction(callback) { return callback(repository); },
    async expireDue(now) {
      for (const grant of state.grants) {
        if (['pending', 'active'].includes(grant.status) && grant.expires_at <= now) {
          grant.status = 'expired';
          grant.invite_token_hash = null;
          for (const claim of state.claims.filter((item) => item.grant_id === grant.id && item.status === 'pending')) {
            claim.status = 'expired';
            claim.decided_at = now;
          }
        }
      }
    },
    async purgeDisposedClaims() {},
    async insertGrant(input) {
      const id = `00000000-0000-4000-8000-${String(grantSequence++).padStart(12, '0')}`;
      const grant = {
        id,
        subject_user_id: input.subjectUserId,
        delegate_user_id: null,
        invite_token_hash: input.inviteTokenHash,
        allowed_fields: input.allowedFields,
        purpose: input.purpose,
        status: 'pending',
        max_uses: input.maxUses,
        uses: 0,
        expires_at: input.expiresAt,
        invited_at: input.now,
        accepted_at: null,
        revoked_at: null,
      };
      state.grants.push(grant);
      return { ...grant };
    },
    async findGrantById(id) {
      return state.grants.find((grant) => grant.id === id) || null;
    },
    async findGrantByInviteHash(hash) {
      return state.grants.find((grant) => grant.invite_token_hash === hash) || null;
    },
    async activateGrant(id, delegateUserId, now) {
      const grant = state.grants.find((item) => item.id === id && item.status === 'pending');
      if (!grant) return null;
      grant.delegate_user_id = delegateUserId;
      grant.status = 'active';
      grant.accepted_at = now;
      grant.invite_token_hash = null;
      return { ...grant };
    },
    async revokeGrant(id, now) {
      const grant = state.grants.find((item) => item.id === id);
      grant.status = 'revoked';
      grant.revoked_at = now;
      grant.invite_token_hash = null;
      for (const claim of state.claims.filter((item) => item.grant_id === id && item.status === 'pending')) {
        claim.status = 'cancelled';
        claim.decided_at = now;
      }
      return { ...grant };
    },
    async incrementUses(id) {
      state.grants.find((grant) => grant.id === id).uses += 1;
    },
    async listGrants(userId, direction) {
      const key = direction === 'incoming' ? 'delegate_user_id' : 'subject_user_id';
      return state.grants.filter((grant) => grant[key] === userId).map((grant) => ({ ...grant }));
    },
    async insertClaims({ grant, actorUserId, claims, now }) {
      return claims.map((claim) => {
        const inserted = {
          id: `10000000-0000-4000-8000-${String(claimSequence++).padStart(12, '0')}`,
          grant_id: grant.id,
          subject_user_id: grant.subject_user_id,
          actor_user_id: actorUserId,
          field: claim.field,
          proposed_value: claim.value,
          status: 'pending',
          expires_at: grant.expires_at,
          created_at: now,
          decided_at: null,
          decided_by: null,
        };
        state.claims.push(inserted);
        return { ...inserted };
      });
    },
    async findClaimWithGrant(id) {
      const claim = state.claims.find((item) => item.id === id);
      if (!claim) return null;
      const grant = state.grants.find((item) => item.id === claim.grant_id);
      return {
        ...claim,
        delegate_user_id: grant.delegate_user_id,
        grant_status: grant.status,
        grant_expires_at: grant.expires_at,
      };
    },
    async listClaims(grantId) {
      return state.claims.filter((claim) => claim.grant_id === grantId).map((claim) => ({ ...claim }));
    },
    async updateClaimStatus(id, status, decidedBy, now) {
      const claim = state.claims.find((item) => item.id === id && item.status === 'pending');
      if (!claim) return null;
      claim.status = status;
      claim.decided_by = decidedBy;
      claim.decided_at = now;
      return { ...claim };
    },
    async applyAcceptedClaim(claim) {
      state.applied.push({ subjectUserId: claim.subject_user_id, field: claim.field, value: claim.proposed_value });
    },
    async insertAudit(event) {
      state.audit.push({ ...event });
    },
    async listAudit(grantId) {
      return state.audit.filter((event) => event.grantId === grantId);
    },
  };
  return repository;
}

test('subject-controlled delegation keeps actor identity and requires per-claim approval', async () => {
  const repository = createMemoryRepository();
  let currentTime = new Date('2026-07-13T00:00:00.000Z');
  const service = createDelegationService({
    repository,
    now: () => currentTime,
    generateInviteToken: () => TOKEN,
  });

  const created = await service.createGrant(SUBJECT, {
    allowed_fields: ['playstyle_tags', 'preference.style.explorer'],
    purpose: '共同入力',
    expires_in_hours: 24,
    max_uses: 2,
  });
  assert.equal(created.inviteToken, TOKEN);
  assert.equal(created.grant.invite_token_hash, undefined);
  assert.equal(repository.state.grants[0].invite_token_hash, hashInviteToken(TOKEN));
  assert.equal((await service.previewInvite(TOKEN)).purpose, '共同入力');
  await assert.rejects(() => service.acceptInvite(SUBJECT, TOKEN), /cannot accept their own/);

  const accepted = await service.acceptInvite(DELEGATE, TOKEN);
  assert.equal(accepted.delegate_user_id, DELEGATE);
  assert.equal(repository.state.grants[0].invite_token_hash, null);
  await assert.rejects(() => service.acceptInvite(STRANGER, TOKEN), /invalid or expired/);

  await assert.rejects(
    () => service.proposeClaims(STRANGER, accepted.id, [{ field: 'playstyle_tags', value: ['gamer_johnny'] }]),
    /accepted delegate/
  );
  await assert.rejects(
    () => service.proposeClaims(DELEGATE, accepted.id, [{ field: 'medical_history', value: 'secret' }]),
    /unsupported/
  );

  const claims = await service.proposeClaims(DELEGATE, accepted.id, [
    { field: 'playstyle_tags', value: ['gamer_johnny', 'mechanics_mimicry'] },
    { field: 'preference.style.explorer', value: 0.75 },
  ]);
  assert.equal(claims.length, 2);
  assert.equal(claims[0].actor_user_id, DELEGATE);
  await assert.rejects(() => service.decideClaim(DELEGATE, claims[0].id, 'accept'), /Only the subject/);

  const approved = await service.decideClaim(SUBJECT, claims[0].id, 'accept');
  const rejected = await service.decideClaim(SUBJECT, claims[1].id, 'reject');
  assert.equal(approved.status, 'accepted');
  assert.equal(rejected.status, 'rejected');
  assert.deepEqual(repository.state.applied, [{
    subjectUserId: SUBJECT,
    field: 'playstyle_tags',
    value: ['gamer_johnny', 'mechanics_mimicry'],
  }]);
  assert.equal(JSON.stringify(repository.state.audit).includes('secret'), false);
  assert.equal(repository.state.audit.some((event) => event.action === 'claim.accepted'), true);

  await assert.rejects(() => service.leaveGrant(STRANGER, accepted.id), /accepted delegate/);
  const left = await service.leaveGrant(DELEGATE, accepted.id);
  assert.equal(left.status, 'revoked');
  assert.equal(repository.state.audit.some((event) => event.action === 'delegation.left'), true);
  await assert.rejects(
    () => service.proposeClaims(DELEGATE, accepted.id, [{ field: 'playstyle_tags', value: ['gamer_spike'] }]),
    /not active/
  );

  currentTime = new Date('2026-07-13T02:00:00.000Z');
  const secondToken = 'b'.repeat(43);
  const secondService = createDelegationService({
    repository,
    now: () => currentTime,
    generateInviteToken: () => secondToken,
  });
  const pending = await secondService.createGrant(SUBJECT, {
    allowed_fields: ['playstyle_tags'],
    purpose: '取消テスト',
  });
  const revoked = await secondService.revokeGrant(SUBJECT, pending.grant.id);
  assert.equal(revoked.status, 'revoked');
  await assert.rejects(() => secondService.acceptInvite(DELEGATE, secondToken), /invalid or expired/);
});

test('expired invitations and grants fail closed', async () => {
  const repository = createMemoryRepository();
  let currentTime = new Date('2026-07-13T00:00:00.000Z');
  const service = createDelegationService({ repository, now: () => currentTime, generateInviteToken: () => TOKEN });
  const created = await service.createGrant(SUBJECT, {
    allowed_fields: ['playstyle_tags'],
    purpose: '短期委任',
    expires_in_hours: 1,
  });
  currentTime = new Date('2026-07-13T02:00:00.000Z');
  await assert.rejects(() => service.acceptInvite(DELEGATE, TOKEN), /invalid or expired/);
  assert.equal(repository.state.grants.find((grant) => grant.id === created.grant.id).status, 'expired');
});
