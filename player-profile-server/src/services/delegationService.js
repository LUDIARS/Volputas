const { createHash, randomBytes } = require('node:crypto');
const { createDelegationRepository } = require('../models/delegationRepository');
const { DelegationError } = require('./delegationError');
const {
  validateClaims,
  validateDecision,
  validateGrantInput,
} = require('./delegationPolicy');

const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;

function hashInviteToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function validateInviteToken(inviteToken) {
  if (typeof inviteToken !== 'string' || !INVITE_TOKEN_PATTERN.test(inviteToken)) {
    throw new DelegationError(400, 'INVALID_INVITE', 'Invite token is invalid');
  }
  return inviteToken;
}

function publicGrant(grant) {
  if (!grant) return null;
  const { invite_token_hash: _inviteTokenHash, ...visible } = grant;
  return visible;
}

function notFound(entity) {
  throw new DelegationError(404, 'NOT_FOUND', `${entity} not found`);
}

function forbidden(message) {
  throw new DelegationError(403, 'DELEGATION_FORBIDDEN', message);
}

function conflict(message) {
  throw new DelegationError(409, 'DELEGATION_CONFLICT', message);
}

function ensureActiveGrant(grant, actorUserId) {
  if (grant.status !== 'active') conflict('Delegation is not active');
  if (grant.delegate_user_id !== actorUserId) forbidden('Only the accepted delegate can propose claims');
  if (grant.uses >= grant.max_uses) conflict('Delegation use limit reached');
}

function ensureParticipant(grant, actorUserId) {
  if (grant.subject_user_id !== actorUserId && grant.delegate_user_id !== actorUserId) {
    forbidden('Only the subject or delegate can access this delegation');
  }
}

function createDelegationService({
  repository = createDelegationRepository(),
  now = () => new Date(),
  generateInviteToken = () => randomBytes(32).toString('base64url'),
} = {}) {
  async function maintain(repo, currentTime) {
    await repo.expireDue(currentTime);
    await repo.purgeDisposedClaims(currentTime);
  }

  return {
    async createGrant(subjectUserId, input) {
      const validated = validateGrantInput(input);
      const currentTime = now();
      const inviteToken = generateInviteToken();
      if (!INVITE_TOKEN_PATTERN.test(inviteToken)) {
        throw new Error('Generated invite token does not meet the security contract');
      }
      const grant = await repository.transaction(async (repo) => {
        await maintain(repo, currentTime);
        const inserted = await repo.insertGrant({
          subjectUserId,
          inviteTokenHash: hashInviteToken(inviteToken),
          allowedFields: validated.allowedFields,
          purpose: validated.purpose,
          maxUses: validated.maxUses,
          expiresAt: new Date(currentTime.getTime() + validated.expiresInHours * 60 * 60 * 1000),
          now: currentTime,
        });
        await repo.insertAudit({
          grantId: inserted.id,
          subjectUserId,
          actorUserId: subjectUserId,
          action: 'delegation.invited',
          metadata: { allowed_fields: validated.allowedFields, max_uses: validated.maxUses },
          now: currentTime,
        });
        return inserted;
      });
      return { grant: publicGrant(grant), inviteToken };
    },

    async acceptInvite(delegateUserId, inviteToken) {
      validateInviteToken(inviteToken);
      const currentTime = now();
      return repository.transaction(async (repo) => {
        await maintain(repo, currentTime);
        const grant = await repo.findGrantByInviteHash(hashInviteToken(inviteToken), { forUpdate: true });
        if (!grant || grant.status !== 'pending') {
          throw new DelegationError(404, 'INVALID_INVITE', 'Invite token is invalid or expired');
        }
        if (grant.subject_user_id === delegateUserId) {
          forbidden('The subject cannot accept their own delegation');
        }
        const activated = await repo.activateGrant(grant.id, delegateUserId, currentTime);
        if (!activated) conflict('Delegation was already accepted or revoked');
        await repo.insertAudit({
          grantId: grant.id,
          subjectUserId: grant.subject_user_id,
          actorUserId: delegateUserId,
          action: 'delegation.accepted',
          now: currentTime,
        });
        return publicGrant(activated);
      });
    },

    async previewInvite(inviteToken) {
      validateInviteToken(inviteToken);
      const currentTime = now();
      await maintain(repository, currentTime);
      const grant = await repository.findGrantByInviteHash(hashInviteToken(inviteToken));
      if (!grant || grant.status !== 'pending') {
        throw new DelegationError(404, 'INVALID_INVITE', 'Invite token is invalid or expired');
      }
      return publicGrant(grant);
    },

    async revokeGrant(subjectUserId, grantId) {
      const currentTime = now();
      return repository.transaction(async (repo) => {
        await maintain(repo, currentTime);
        const grant = await repo.findGrantById(grantId, { forUpdate: true });
        if (!grant) notFound('Delegation');
        if (grant.subject_user_id !== subjectUserId) forbidden('Only the subject can revoke a delegation');
        if (!['pending', 'active'].includes(grant.status)) conflict('Delegation is already inactive');
        const revoked = await repo.revokeGrant(grant.id, currentTime);
        await repo.insertAudit({
          grantId: grant.id,
          subjectUserId,
          actorUserId: subjectUserId,
          action: 'delegation.revoked',
          now: currentTime,
        });
        return publicGrant(revoked);
      });
    },

    async leaveGrant(delegateUserId, grantId) {
      const currentTime = now();
      return repository.transaction(async (repo) => {
        await maintain(repo, currentTime);
        const grant = await repo.findGrantById(grantId, { forUpdate: true });
        if (!grant) notFound('Delegation');
        if (grant.delegate_user_id !== delegateUserId) forbidden('Only the accepted delegate can leave a delegation');
        if (grant.status !== 'active') conflict('Delegation is already inactive');
        const revoked = await repo.revokeGrant(grant.id, currentTime);
        await repo.insertAudit({
          grantId: grant.id,
          subjectUserId: grant.subject_user_id,
          actorUserId: delegateUserId,
          action: 'delegation.left',
          now: currentTime,
        });
        return publicGrant(revoked);
      });
    },

    async listGrants(userId, direction = 'outgoing') {
      if (direction !== 'outgoing' && direction !== 'incoming') {
        throw new DelegationError(400, 'INVALID_DELEGATION_INPUT', 'direction must be outgoing or incoming');
      }
      const currentTime = now();
      await maintain(repository, currentTime);
      const grants = await repository.listGrants(userId, direction);
      return grants.map(publicGrant);
    },

    async proposeClaims(delegateUserId, grantId, value) {
      const claims = validateClaims(value);
      const currentTime = now();
      return repository.transaction(async (repo) => {
        await maintain(repo, currentTime);
        const grant = await repo.findGrantById(grantId, { forUpdate: true });
        if (!grant) notFound('Delegation');
        ensureActiveGrant(grant, delegateUserId);
        const allowedFields = new Set(grant.allowed_fields);
        if (claims.some((claim) => !allowedFields.has(claim.field))) {
          forbidden('A claim field is outside the delegated scope');
        }
        const inserted = await repo.insertClaims({ grant, actorUserId: delegateUserId, claims, now: currentTime });
        await repo.incrementUses(grant.id);
        await repo.insertAudit({
          grantId: grant.id,
          subjectUserId: grant.subject_user_id,
          actorUserId: delegateUserId,
          action: 'claims.proposed',
          metadata: { fields: claims.map((claim) => claim.field), count: claims.length },
          now: currentTime,
        });
        return inserted;
      });
    },

    async decideClaim(subjectUserId, claimId, decisionValue) {
      const decision = validateDecision(decisionValue);
      const currentTime = now();
      return repository.transaction(async (repo) => {
        await maintain(repo, currentTime);
        const claim = await repo.findClaimWithGrant(claimId, { forUpdate: true });
        if (!claim) notFound('Claim');
        if (claim.subject_user_id !== subjectUserId) forbidden('Only the subject can decide a claim');
        if (claim.status !== 'pending' || claim.grant_status !== 'active') conflict('Claim is no longer pending');
        if (decision === 'accept') await repo.applyAcceptedClaim(claim);
        const updated = await repo.updateClaimStatus(
          claim.id,
          decision === 'accept' ? 'accepted' : 'rejected',
          subjectUserId,
          currentTime
        );
        if (!updated) conflict('Claim was already decided');
        await repo.insertAudit({
          grantId: claim.grant_id,
          claimId: claim.id,
          subjectUserId,
          actorUserId: subjectUserId,
          action: `claim.${decision}ed`,
          metadata: { field: claim.field },
          now: currentTime,
        });
        return updated;
      });
    },

    async withdrawClaim(delegateUserId, claimId) {
      const currentTime = now();
      return repository.transaction(async (repo) => {
        await maintain(repo, currentTime);
        const claim = await repo.findClaimWithGrant(claimId, { forUpdate: true });
        if (!claim) notFound('Claim');
        if (claim.actor_user_id !== delegateUserId) forbidden('Only the proposing delegate can withdraw a claim');
        if (claim.status !== 'pending') conflict('Claim is no longer pending');
        const updated = await repo.updateClaimStatus(claim.id, 'withdrawn', delegateUserId, currentTime);
        await repo.insertAudit({
          grantId: claim.grant_id,
          claimId: claim.id,
          subjectUserId: claim.subject_user_id,
          actorUserId: delegateUserId,
          action: 'claim.withdrawn',
          metadata: { field: claim.field },
          now: currentTime,
        });
        return updated;
      });
    },

    async listClaims(userId, grantId) {
      const currentTime = now();
      await maintain(repository, currentTime);
      const grant = await repository.findGrantById(grantId);
      if (!grant) notFound('Delegation');
      ensureParticipant(grant, userId);
      return repository.listClaims(grantId);
    },

    async listAudit(userId, grantId) {
      const currentTime = now();
      await maintain(repository, currentTime);
      const grant = await repository.findGrantById(grantId);
      if (!grant) notFound('Delegation');
      ensureParticipant(grant, userId);
      return repository.listAudit(grantId);
    },
  };
}

module.exports = { createDelegationService, hashInviteToken };
