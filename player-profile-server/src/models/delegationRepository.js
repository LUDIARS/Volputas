const db = require('../config/database');

const DISPOSED_CLAIM_RETENTION = '30 days';

function operations(executor) {
  const query = (text, params) => executor.query(text, params);

  return {
    async expireDue(now) {
      await query(
        `WITH expired_grants AS (
           UPDATE profile_delegation_grants
              SET status = 'expired', invite_token_hash = NULL
            WHERE status IN ('pending', 'active') AND expires_at <= $1
          RETURNING id
         )
         UPDATE profile_claims
            SET status = 'expired', decided_at = $1
          WHERE status = 'pending' AND grant_id IN (SELECT id FROM expired_grants)`,
        [now]
      );
    },

    async purgeDisposedClaims(now) {
      const result = await query(
        `DELETE FROM profile_claims
          WHERE status IN ('rejected', 'withdrawn', 'expired', 'cancelled')
            AND decided_at < $1 - $2::interval`,
        [now, DISPOSED_CLAIM_RETENTION]
      );
      return result.rowCount || 0;
    },

    async insertGrant(input) {
      const { rows } = await query(
        `INSERT INTO profile_delegation_grants
           (subject_user_id, invite_token_hash, allowed_fields, purpose, max_uses, expires_at, invited_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, subject_user_id, delegate_user_id, allowed_fields, purpose, status,
                   max_uses, uses, expires_at, invited_at, accepted_at, revoked_at`,
        [
          input.subjectUserId,
          input.inviteTokenHash,
          input.allowedFields,
          input.purpose,
          input.maxUses,
          input.expiresAt,
          input.now,
        ]
      );
      return rows[0];
    },

    async findGrantById(id, { forUpdate = false } = {}) {
      const { rows } = await query(
        `SELECT id, subject_user_id, delegate_user_id, invite_token_hash, allowed_fields, purpose,
                status, max_uses, uses, expires_at, invited_at, accepted_at, revoked_at
           FROM profile_delegation_grants WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
        [id]
      );
      return rows[0] || null;
    },

    async findGrantByInviteHash(inviteTokenHash, { forUpdate = false } = {}) {
      const { rows } = await query(
        `SELECT id, subject_user_id, delegate_user_id, invite_token_hash, allowed_fields, purpose,
                status, max_uses, uses, expires_at, invited_at, accepted_at, revoked_at
           FROM profile_delegation_grants
          WHERE invite_token_hash = $1${forUpdate ? ' FOR UPDATE' : ''}`,
        [inviteTokenHash]
      );
      return rows[0] || null;
    },

    async activateGrant(id, delegateUserId, now) {
      const { rows } = await query(
        `UPDATE profile_delegation_grants
            SET delegate_user_id = $2, status = 'active', accepted_at = $3, invite_token_hash = NULL
          WHERE id = $1 AND status = 'pending'
          RETURNING id, subject_user_id, delegate_user_id, allowed_fields, purpose, status,
                    max_uses, uses, expires_at, invited_at, accepted_at, revoked_at`,
        [id, delegateUserId, now]
      );
      return rows[0] || null;
    },

    async revokeGrant(id, now) {
      const { rows } = await query(
        `UPDATE profile_delegation_grants
            SET status = 'revoked', revoked_at = $2, invite_token_hash = NULL
          WHERE id = $1 AND status IN ('pending', 'active')
          RETURNING id, subject_user_id, delegate_user_id, allowed_fields, purpose, status,
                    max_uses, uses, expires_at, invited_at, accepted_at, revoked_at`,
        [id, now]
      );
      await query(
        `UPDATE profile_claims SET status = 'cancelled', decided_at = $2
          WHERE grant_id = $1 AND status = 'pending'`,
        [id, now]
      );
      return rows[0] || null;
    },

    async incrementUses(id) {
      await query('UPDATE profile_delegation_grants SET uses = uses + 1 WHERE id = $1', [id]);
    },

    async listGrants(userId, direction) {
      const column = direction === 'incoming' ? 'delegate_user_id' : 'subject_user_id';
      const { rows } = await query(
        `SELECT id, subject_user_id, delegate_user_id, allowed_fields, purpose, status,
                max_uses, uses, expires_at, invited_at, accepted_at, revoked_at
           FROM profile_delegation_grants
          WHERE ${column} = $1
          ORDER BY invited_at DESC`,
        [userId]
      );
      return rows;
    },

    async insertClaims({ grant, actorUserId, claims, now }) {
      const rows = [];
      for (const claim of claims) {
        const result = await query(
          `INSERT INTO profile_claims
             (grant_id, subject_user_id, actor_user_id, field, proposed_value, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
           RETURNING id, grant_id, subject_user_id, actor_user_id, field, proposed_value,
                     status, expires_at, created_at, decided_at, decided_by`,
          [grant.id, grant.subject_user_id, actorUserId, claim.field, JSON.stringify(claim.value), grant.expires_at, now]
        );
        rows.push(result.rows[0]);
      }
      return rows;
    },

    async findClaimWithGrant(id, { forUpdate = false } = {}) {
      const { rows } = await query(
        `SELECT c.id, c.grant_id, c.subject_user_id, c.actor_user_id, c.field,
                c.proposed_value, c.status, c.expires_at, c.created_at, c.decided_at, c.decided_by,
                g.delegate_user_id, g.status AS grant_status, g.expires_at AS grant_expires_at
           FROM profile_claims c
           JOIN profile_delegation_grants g ON g.id = c.grant_id
          WHERE c.id = $1${forUpdate ? ' FOR UPDATE OF c, g' : ''}`,
        [id]
      );
      return rows[0] || null;
    },

    async listClaims(grantId) {
      const { rows } = await query(
        `SELECT id, grant_id, subject_user_id, actor_user_id, field, proposed_value,
                status, expires_at, created_at, decided_at, decided_by
           FROM profile_claims WHERE grant_id = $1 ORDER BY created_at DESC`,
        [grantId]
      );
      return rows;
    },

    async updateClaimStatus(id, status, decidedBy, now) {
      const { rows } = await query(
        `UPDATE profile_claims
            SET status = $2, decided_by = $3, decided_at = $4
          WHERE id = $1 AND status = 'pending'
          RETURNING id, grant_id, subject_user_id, actor_user_id, field, proposed_value,
                    status, expires_at, created_at, decided_at, decided_by`,
        [id, status, decidedBy, now]
      );
      return rows[0] || null;
    },

    async applyAcceptedClaim(claim) {
      if (claim.field === 'playstyle_tags') {
        await query(
          `INSERT INTO player_profiles (user_id, playstyle_tags)
           VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE SET playstyle_tags = EXCLUDED.playstyle_tags`,
          [claim.subject_user_id, claim.proposed_value]
        );
        return;
      }
      const axis = claim.field.slice('preference.'.length);
      await query(
        `INSERT INTO player_profiles (user_id, personality_data)
         VALUES ($1, jsonb_build_object('delegated_preferences', jsonb_build_object($2, $3::double precision)))
         ON CONFLICT (user_id) DO UPDATE SET personality_data = jsonb_set(
           COALESCE(player_profiles.personality_data, '{}'::jsonb),
           '{delegated_preferences}',
           COALESCE(player_profiles.personality_data->'delegated_preferences', '{}'::jsonb)
             || jsonb_build_object($2, $3::double precision),
           true
         )`,
        [claim.subject_user_id, axis, claim.proposed_value]
      );
    },

    async insertAudit(event) {
      await query(
        `INSERT INTO delegation_audit_events
           (grant_id, claim_id, subject_user_id, actor_user_id, action, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          event.grantId,
          event.claimId || null,
          event.subjectUserId,
          event.actorUserId || null,
          event.action,
          JSON.stringify(event.metadata || {}),
          event.now,
        ]
      );
    },

    async listAudit(grantId) {
      const { rows } = await query(
        `SELECT id, grant_id, claim_id, subject_user_id, actor_user_id, action, metadata, created_at
           FROM delegation_audit_events WHERE grant_id = $1 ORDER BY created_at DESC`,
        [grantId]
      );
      return rows;
    },
  };
}

function createDelegationRepository(database = db) {
  return {
    ...operations(database),
    transaction(callback) {
      return database.transaction((client) => callback(operations(client)));
    },
  };
}

module.exports = { createDelegationRepository };
