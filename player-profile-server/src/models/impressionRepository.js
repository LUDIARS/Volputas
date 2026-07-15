const db = require('../config/database');

function mapImpression(row, assets) {
  return {
    id: row.id,
    user_id: row.user_id,
    session_id: row.session_id,
    client_submission_id: row.client_submission_id,
    capture_anchor_id: row.capture_anchor_id,
    text: row.body,
    captured_at: row.captured_at,
    playtime: {
      elapsed_ms: Number(row.elapsed_ms),
      active_ms: Number(row.active_ms),
    },
    status: row.status,
    client: row.client_metadata,
    rejection_reason: row.rejection_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
    request_hash: row.request_hash,
    assets: assets.map((asset) => ({
      id: asset.id,
      client_asset_id: asset.client_asset_id,
      kind: asset.kind,
      status: asset.status,
      object_key: asset.object_key,
      mime_type: asset.mime_type,
      size_bytes: Number(asset.size_bytes),
      sha256: asset.sha256,
      width: asset.width,
      height: asset.height,
      duration_ms: asset.duration_ms,
      captured_at: asset.captured_at,
      clip_started_at: asset.clip_started_at,
      clip_ended_at: asset.clip_ended_at,
      metadata: asset.metadata,
      delivery_object_key: asset.delivery_object_key,
      thumbnail_object_key: asset.thumbnail_object_key,
      delivery_mime_type: asset.delivery_mime_type,
      delivery_size_bytes: asset.delivery_size_bytes === null ? null : Number(asset.delivery_size_bytes),
      original_delete_after: asset.original_delete_after,
    })),
  };
}

function createImpressionRepository(database = db) {
  async function load(queryable, impressionId, userId, includeDeleted = false) {
    const { rows } = await queryable.query(
      `SELECT * FROM play_impressions
       WHERE id = $1 AND user_id = $2 ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`,
      [impressionId, userId]
    );
    if (!rows[0]) return null;
    const { rows: assets } = await queryable.query(
      'SELECT * FROM impression_assets WHERE impression_id = $1 ORDER BY created_at ASC',
      [impressionId]
    );
    return mapImpression(rows[0], assets);
  }

  return {
    async createOrGet(input) {
      return database.transaction(async (client) => {
        const { rows: sessions } = await client.query(
          'SELECT id FROM play_sessions WHERE id = $1 AND user_id = $2 FOR SHARE',
          [input.sessionId, input.userId]
        );
        if (!sessions[0]) return { kind: 'session_not_found' };

        await client.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [`${input.userId}:${input.clientSubmissionId}`]
        );
        const { rows: existingRows } = await client.query(
          `SELECT id, request_hash FROM play_impressions
           WHERE user_id = $1 AND client_submission_id = $2`,
          [input.userId, input.clientSubmissionId]
        );
        if (existingRows[0]) {
          if (existingRows[0].request_hash !== input.requestHash) return { kind: 'idempotency_conflict' };
          return { kind: 'existing', impression: await load(client, existingRows[0].id, input.userId) };
        }

        await client.query(
          `INSERT INTO play_impressions (
             id, user_id, session_id, client_submission_id, request_hash, capture_anchor_id,
             body, captured_at, elapsed_ms, active_ms, status, client_metadata
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            input.impressionId,
            input.userId,
            input.sessionId,
            input.clientSubmissionId,
            input.requestHash,
            input.captureAnchorId,
            input.text,
            input.capturedAt,
            input.elapsedMs,
            input.activeMs,
            input.assets.length === 0 ? 'draft' : 'uploading',
            JSON.stringify(input.clientMetadata),
          ]
        );

        for (const asset of input.assets) {
          await client.query(
            `INSERT INTO impression_assets (
               id, impression_id, client_asset_id, kind, status, object_key, mime_type,
               size_bytes, sha256, width, height, duration_ms, captured_at,
               clip_started_at, clip_ended_at, metadata
             ) VALUES ($1, $2, $3, $4, 'reserved', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
              asset.id,
              input.impressionId,
              asset.clientAssetId,
              asset.kind,
              asset.objectKey,
              asset.mimeType,
              asset.sizeBytes,
              asset.sha256,
              asset.width,
              asset.height,
              asset.durationMs,
              asset.capturedAt,
              asset.clipStartedAt,
              asset.clipEndedAt,
              JSON.stringify(asset.metadata),
            ]
          );
        }

        return { kind: 'created', impression: await load(client, input.impressionId, input.userId) };
      });
    },

    getOwned(impressionId, userId) {
      return load(database, impressionId, userId);
    },

    async markProcessing(impressionId, userId) {
      return database.transaction(async (client) => {
        const impression = await load(client, impressionId, userId);
        if (!impression) return null;
        if (['processing', 'ready'].includes(impression.status)) return impression;
        const nextStatus = impression.assets.length === 0 ? 'ready' : 'processing';
        const { rows } = await client.query(
          `UPDATE play_impressions SET status = $3, rejection_reason = NULL
           WHERE id = $1 AND user_id = $2 AND status IN ('draft', 'uploading')
           RETURNING id`,
          [impressionId, userId, nextStatus]
        );
        if (!rows[0]) return await load(client, impressionId, userId);
        if (impression.assets.length > 0) {
          await client.query(
            `UPDATE impression_assets SET status = 'processing'
             WHERE impression_id = $1 AND status = 'reserved'`,
            [impressionId]
          );
          await client.query(
            `INSERT INTO impression_processing_jobs (impression_id)
             VALUES ($1)
             ON CONFLICT (impression_id) DO UPDATE
               SET state = 'pending', next_attempt_at = now(), last_error = NULL`,
            [impressionId]
          );
        }
        await client.query(
          `INSERT INTO play_events (session_id, event_type, event_data, occurred_at)
           VALUES ($1, 'impression_submitted', $2, $3)`,
          [
            impression.session_id,
            JSON.stringify({
              impression_id: impression.id,
              capture_anchor_id: impression.capture_anchor_id,
              asset_kinds: impression.assets.map((asset) => asset.kind),
            }),
            impression.captured_at,
          ]
        );
        return await load(client, impressionId, userId);
      });
    },

    async markRejected(impressionId, userId, reason) {
      await database.query(
        `UPDATE play_impressions SET status = 'rejected', rejection_reason = $3
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [impressionId, userId, reason]
      );
      await database.query(
        `UPDATE impression_assets SET status = 'rejected'
         WHERE impression_id = $1 AND status NOT IN ('ready', 'deleted')`,
        [impressionId]
      );
    },

    async beginDeletion(impressionId, userId) {
      const { rows } = await database.query(
        `UPDATE play_impressions SET status = 'deletion_pending'
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [impressionId, userId]
      );
      if (!rows[0]) return null;
      await database.query(
        `UPDATE impression_assets SET status = 'deletion_pending'
         WHERE impression_id = $1 AND status <> 'deleted'`,
        [impressionId]
      );
      return load(database, impressionId, userId);
    },

    async finishDeletion(impressionId, userId, objectCount) {
      await database.transaction(async (client) => {
        await client.query(
          `UPDATE impression_assets SET status = 'deleted' WHERE impression_id = $1`,
          [impressionId]
        );
        await client.query(
          `UPDATE play_impressions SET status = 'deleted', deleted_at = now()
           WHERE id = $1 AND user_id = $2`,
          [impressionId, userId]
        );
        await client.query(
          `INSERT INTO impression_deletion_audit (impression_id, user_id, object_count, outcome)
           VALUES ($1, $2, $3, 'deleted')`,
          [impressionId, userId, objectCount]
        );
      });
    },

    async recordDeletionFailure(impressionId, userId, objectCount) {
      await database.query(
        `INSERT INTO impression_deletion_audit (impression_id, user_id, object_count, outcome)
         VALUES ($1, $2, $3, 'failed')`,
        [impressionId, userId, objectCount]
      );
    },

    async claimProcessingJob(workerId) {
      return database.transaction(async (client) => {
        const { rows } = await client.query(
          `SELECT impression_id FROM impression_processing_jobs
           WHERE next_attempt_at <= now()
             AND (state = 'pending' OR (state = 'processing' AND locked_at < now() - interval '10 minutes'))
           ORDER BY next_attempt_at ASC
           FOR UPDATE SKIP LOCKED LIMIT 1`
        );
        if (!rows[0]) return null;
        const { rows: updatedJobs } = await client.query(
          `UPDATE impression_processing_jobs
           SET state = 'processing', attempts = attempts + 1, locked_at = now(), locked_by = $2
           WHERE impression_id = $1 RETURNING attempts`,
          [rows[0].impression_id, workerId]
        );
        const { rows: impressions } = await client.query(
          'SELECT * FROM play_impressions WHERE id = $1 AND deleted_at IS NULL',
          [rows[0].impression_id]
        );
        if (!impressions[0]) return null;
        const { rows: assets } = await client.query(
          'SELECT * FROM impression_assets WHERE impression_id = $1 ORDER BY created_at',
          [rows[0].impression_id]
        );
        return { ...mapImpression(impressions[0], assets), processing_attempts: updatedJobs[0].attempts };
      });
    },

    async completeProcessing(impressionId, results, originalDeleteAfter) {
      return database.transaction(async (client) => {
        const { rows: impressions } = await client.query(
          'SELECT status FROM play_impressions WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
          [impressionId]
        );
        if (impressions[0]?.status !== 'processing') return false;
        for (const result of results) {
          await client.query(
            `UPDATE impression_assets SET
               status = 'ready', delivery_object_key = $2, thumbnail_object_key = $3,
               delivery_mime_type = $4, delivery_size_bytes = $5,
               width = COALESCE($6, width), height = COALESCE($7, height),
               duration_ms = COALESCE($8, duration_ms), original_delete_after = $9,
               metadata = metadata || $10::jsonb
             WHERE id = $1 AND impression_id = $11`,
            [
              result.assetId,
              result.deliveryObjectKey,
              result.thumbnailObjectKey,
              result.deliveryMimeType,
              result.deliverySizeBytes,
              result.width,
              result.height,
              result.durationMs,
              originalDeleteAfter,
              JSON.stringify(result.metadata || {}),
              impressionId,
            ]
          );
        }
        await client.query(
          `UPDATE play_impressions SET status = 'ready', rejection_reason = NULL WHERE id = $1`,
          [impressionId]
        );
        await client.query(
          `UPDATE impression_processing_jobs
           SET state = 'complete', locked_at = NULL, locked_by = NULL, last_error = NULL
           WHERE impression_id = $1`,
          [impressionId]
        );
        return true;
      });
    },

    async failProcessing(impressionId, reason, permanent, nextAttemptAt) {
      await database.transaction(async (client) => {
        if (permanent) {
          await client.query(
            `UPDATE play_impressions SET status = 'rejected', rejection_reason = $2 WHERE id = $1`,
            [impressionId, reason]
          );
          await client.query(
            `UPDATE impression_assets SET status = 'rejected'
             WHERE impression_id = $1 AND status <> 'ready'`,
            [impressionId]
          );
        }
        await client.query(
          `UPDATE impression_processing_jobs SET
             state = $2, next_attempt_at = $3, locked_at = NULL, locked_by = NULL, last_error = $4
           WHERE impression_id = $1`,
          [impressionId, permanent ? 'failed' : 'pending', nextAttemptAt, reason]
        );
      });
    },

    async listExpiredOriginals(limit = 100) {
      const { rows } = await database.query(
        `SELECT id, object_key FROM impression_assets
         WHERE status = 'ready' AND original_delete_after IS NOT NULL AND original_delete_after <= now()
         ORDER BY original_delete_after LIMIT $1`,
        [limit]
      );
      return rows;
    },

    async markOriginalDeleted(assetId) {
      await database.query(
        `UPDATE impression_assets
         SET original_delete_after = NULL, metadata = metadata || '{"original_deleted": true}'::jsonb
         WHERE id = $1`,
        [assetId]
      );
    },
  };
}

module.exports = createImpressionRepository();
module.exports.createImpressionRepository = createImpressionRepository;
