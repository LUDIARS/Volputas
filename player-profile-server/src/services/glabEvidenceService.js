const fs = require('node:fs/promises');
const { AppError } = require('../middleware/errorHandler');
const { mediaKindMatchesRecord } = require('./evidenceMedia');
const { GAME_LOG_EXCERPT_LIMIT } = require('./emotionCurveEvaluationPrompt');
const { resolveActiveGameTitle } = require('./glabGameSelection');
const { validateGlabEmotionCurveInput } = require('./profileEvidenceSchemas');

const EMOTION_CURVES = 'emotion-curves';
const MAX_UTF8_BYTES_PER_CHARACTER = 4;
const GAME_LOG_READ_LIMIT_BYTES = GAME_LOG_EXCERPT_LIMIT * MAX_UTF8_BYTES_PER_CHARACTER + 3;

function evidenceView(record) {
  const view = { ...record };
  delete view.userId;
  return view;
}

async function readGameLogExcerpt(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(GAME_LOG_READ_LIMIT_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8').slice(0, GAME_LOG_EXCERPT_LIMIT);
  } finally {
    await handle.close();
  }
}

// 感情曲線を GLAB から扱うための service。
//
// 自前フロント向けの routes/profileEvidence は Volputas のローカル user id で
// 動くが、 GLAB から届くのは Cernere の user id だけで、 ローカル users 行が
// 無いこともある。 owner id をそのまま使う経路をここに分けて、 既存経路の
// 認可規則 (所有チェックと媒体種別の対応) は同じものを使い回す。
/**
 * @implements SPEC-GLAB-EVIDENCE-OWNER-SCOPE
 * @implements SPEC-GLAB-EVIDENCE-MEDIA-TRANSPORT
 */
function createGlabEvidenceService({
  evidenceStore,
  mediaStore,
  mediaRoot,
  emotionCurveEvaluator,
  gameRepository,
  issueTicket,
}) {
  if (
    !evidenceStore || !mediaStore || !mediaRoot || !emotionCurveEvaluator
    || !gameRepository || !issueTicket
  ) {
    throw new TypeError(
      'evidenceStore, mediaStore, mediaRoot, emotionCurveEvaluator, gameRepository, '
      + 'and issueTicket are required',
    );
  }

  function mediaContext(ownerId, kind, recordId) {
    return {
      repositoryRoot: mediaRoot,
      name: ownerId,
      kind,
      recordId,
    };
  }

  async function ownedEmotionCurve(ownerId, recordId) {
    const owned = await evidenceStore.findForOwner(ownerId, recordId);
    if (!owned || owned.kind !== EMOTION_CURVES) {
      throw new AppError(404, 'PROFILE_RECORD_NOT_FOUND', 'Emotion curve not found');
    }
    return owned;
  }

  return {
    async listEmotionCurves(ownerId) {
      const records = await evidenceStore.listForOwner(ownerId, EMOTION_CURVES);
      return records.map(evidenceView);
    },

    async createEmotionCurve(ownerId, body) {
      const input = validateGlabEmotionCurveInput(body);
      const record = await evidenceStore.createForOwner(ownerId, EMOTION_CURVES, {
        ...input,
        gameTitle: await resolveActiveGameTitle(gameRepository, input),
      });
      return evidenceView(record);
    },

    async saveMedia(ownerId, { kind, recordId, contentType, stream }) {
      const owned = await evidenceStore.findForOwner(ownerId, recordId);
      if (!owned || !mediaKindMatchesRecord(kind, owned.kind)) {
        throw new AppError(404, 'PROFILE_RECORD_NOT_FOUND', 'Profile record not found');
      }
      const context = mediaContext(ownerId, kind, recordId);
      const result = await mediaStore.save({ ...context, contentType, stream });
      try {
        await evidenceStore.saveMediaForOwner(ownerId, {
          recordId,
          kind,
          contentType: result.contentType,
          bytes: result.bytes,
        });
      } catch (error) {
        // メタデータが載らなかったファイルは誰からも参照できない。 Cernere 側の
        // 失敗を主エラーとして返しつつ、 孤児ファイルは片付ける。
        await mediaStore.remove(context).catch(() => {
          // Best-effort cleanup: preserve the Cernere metadata failure as primary.
        });
        throw error;
      }
      return { bytes: result.bytes, contentType: result.contentType };
    },

    // チケット認可の再生口から呼ばれる。 所有と媒体種別の対応を確かめてから
    // 実ファイルを返す。
    async resolveMedia(ownerId, { kind, recordId }) {
      const owned = await evidenceStore.findForOwner(ownerId, recordId);
      const metadata = owned
        ? await evidenceStore.findMediaForOwner(ownerId, recordId, kind)
        : null;
      if (!owned || !metadata || !mediaKindMatchesRecord(kind, owned.kind)) {
        throw new AppError(404, 'MEDIA_NOT_FOUND', 'Media not found');
      }
      const media = await mediaStore.resolve(mediaContext(ownerId, kind, recordId));
      if (!media) throw new AppError(404, 'MEDIA_NOT_FOUND', 'Media not found');
      return media;
    },

    async issueMediaTicket(ownerId, { kind, recordId }) {
      const owned = await evidenceStore.findForOwner(ownerId, recordId);
      const metadata = owned
        ? await evidenceStore.findMediaForOwner(ownerId, recordId, kind)
        : null;
      if (!owned || !metadata || !mediaKindMatchesRecord(kind, owned.kind)) {
        throw new AppError(404, 'MEDIA_NOT_FOUND', 'Media not found');
      }
      return issueTicket({ userId: ownerId, kind, recordId });
    },

    async evaluateEmotionCurve(ownerId, recordId) {
      const owned = await ownedEmotionCurve(ownerId, recordId);
      const persona = await evidenceStore.readAnalysisForOwner(ownerId);
      // An on-disk orphan is not an authorized attachment. Evaluation follows
      // the same owner-scoped metadata boundary as playback and ticket issue.
      const metadata = await evidenceStore.findMediaForOwner(
        ownerId,
        recordId,
        'game-logs',
      );
      const media = metadata
        ? await mediaStore.resolve(mediaContext(ownerId, 'game-logs', recordId))
        : null;
      const evaluation = await emotionCurveEvaluator.evaluate({
        record: owned.record,
        persona,
        gameLogText: media ? await readGameLogExcerpt(media.filePath) : null,
      });
      const record = await evidenceStore.updateForOwner(
        ownerId,
        EMOTION_CURVES,
        recordId,
        { evaluation },
      );
      if (!record) throw new AppError(404, 'PROFILE_RECORD_NOT_FOUND', 'Emotion curve not found');
      return evidenceView(record);
    },
  };
}

module.exports = { EMOTION_CURVES, createGlabEvidenceService };
