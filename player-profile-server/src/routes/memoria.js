const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { AppError } = require('../middleware/errorHandler');
const memoriaModel = require('../models/memoriaModel');
const profileModel = require('../models/profileModel');
const memoriaService = require('../services/memoriaService');
const tokenCrypto = require('../services/tokenCrypto');

const router = Router();

router.use(authenticate);

function mapMemoriaError(err) {
  if (err.code === 'MEMORIA_INVALID_URL') return new AppError(400, err.code, err.message);
  if (err.code === 'MEMORIA_TOKEN_REQUIRED') return new AppError(400, err.code, err.message);
  if (err.code === 'MEMORIA_UNREACHABLE') return new AppError(502, err.code, err.message);
  if (err.code === 'MEMORIA_NOT_AVAILABLE') return new AppError(404, err.code, err.message);
  if (err.code === 'MEMORIA_API_ERROR') return new AppError(502, err.code, err.message);
  if (err.code === 'MEMORIA_INVALID_RESPONSE') return new AppError(502, err.code, err.message);
  return err;
}

async function syncAndDraft(userId, baseUrl, token) {
  const features = await memoriaService.fetchPersonalityFeatures(baseUrl, token);
  await memoriaModel.touchSync(userId);
  return memoriaModel.createDraft(userId, { axes: features.axes, computedAt: features.computedAt });
}

// GET /api/v1/users/me/memoria — link status + latest draft
router.get('/', async (req, res, next) => {
  try {
    const link = await memoriaModel.getLink(req.user.id);
    if (!link) return res.json({ ok: true, data: { linked: false } });
    const latestDraft = await memoriaModel.getLatestDraft(req.user.id);
    res.json({
      ok: true,
      data: {
        linked: true,
        link: { memoriaBaseUrl: link.memoria_base_url, linkedAt: link.linked_at, lastSyncedAt: link.last_synced_at },
        latestDraft,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/users/me/memoria/link — { baseUrl, token } issued from Memoria's settings UI
router.post('/link', validate({
  body: {
    baseUrl: { required: true, type: 'string', maxLength: 500 },
    token: { required: true, type: 'string', maxLength: 500 },
  },
}), async (req, res, next) => {
  try {
    const normalized = memoriaService.normalizeBaseUrl(req.body.baseUrl);
    // 保存前に一度疎通確認 (無効なURL/token を保存してしまわないため)
    await memoriaService.fetchPersonalityFeatures(normalized, req.body.token);

    const tokenCiphertext = tokenCrypto.encrypt(req.body.token);
    await memoriaModel.upsertLink(req.user.id, { baseUrl: normalized, tokenCiphertext });
    const draft = await syncAndDraft(req.user.id, normalized, req.body.token);

    res.status(201).json({ ok: true, data: { linked: true, draft } });
  } catch (err) {
    next(mapMemoriaError(err));
  }
});

// POST /api/v1/users/me/memoria/sync — re-fetch features for the already-linked account
router.post('/sync', async (req, res, next) => {
  try {
    const link = await memoriaModel.getLink(req.user.id);
    if (!link) throw new AppError(404, 'NOT_LINKED', 'No Memoria account linked');

    const token = tokenCrypto.decrypt(link.token_ciphertext);
    const draft = await syncAndDraft(req.user.id, link.memoria_base_url, token);
    res.json({ ok: true, data: { linked: true, draft } });
  } catch (err) {
    next(mapMemoriaError(err));
  }
});

// POST /api/v1/users/me/memoria/drafts/:id/approve — apply the draft's axes to the profile
router.post('/drafts/:id/approve', validate({
  params: { id: { required: true, type: 'uuid' } },
}), async (req, res, next) => {
  try {
    const draft = await memoriaModel.getPendingDraftForUser(req.params.id, req.user.id);
    if (!draft) throw new AppError(404, 'NOT_FOUND', 'No pending draft found');

    const approved = await memoriaModel.setDraftStatus(req.params.id, req.user.id, 'approved');
    const profile = await profileModel.mergePersonalityAxes(req.user.id, draft.axes);
    res.json({ ok: true, data: { draft: approved, profile } });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/users/me/memoria/drafts/:id/reject
router.post('/drafts/:id/reject', validate({
  params: { id: { required: true, type: 'uuid' } },
}), async (req, res, next) => {
  try {
    const rejected = await memoriaModel.setDraftStatus(req.params.id, req.user.id, 'rejected');
    if (!rejected) throw new AppError(404, 'NOT_FOUND', 'No pending draft found');
    res.json({ ok: true, data: { draft: rejected } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/users/me/memoria — unlink (drafts are kept for audit; credential is removed)
router.delete('/', async (req, res, next) => {
  try {
    const deleted = await memoriaModel.deleteLink(req.user.id);
    if (!deleted) throw new AppError(404, 'NOT_LINKED', 'No Memoria account linked');
    res.json({ ok: true, data: { message: 'Memoria account unlinked' } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
