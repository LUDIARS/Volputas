const { createHash } = require('node:crypto');
const { validateVoiceInput } = require('./profileEvidenceSchemas');

/** @implements SPEC-DISCUSSION-RETURN-PAGINATION */
function importedDiscussion(record) {
  return record?.sourceKind === 'discussion'
    && typeof record.sourceRef === 'string'
    && typeof record.occurredAt === 'string';
}

/** @implements SPEC-DISCUSSION-RETURN-PAGINATION */
function latestOccurredAt(records) {
  return (records || [])
    .filter(importedDiscussion)
    .reduce((latest, record) => {
      const timestamp = Date.parse(record.occurredAt);
      return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
    }, 0);
}

/** @implements SPEC-DISCUSSION-RETURN-PAGINATION */
function discussionSourceRef(utterance) {
  return `di:${createHash('sha256')
    .update(utterance.createdAt)
    .update('\0')
    .update(utterance.text)
    .digest('base64url')}`;
}

class DiscussionImportService {
  /** @implements SPEC-DISCUSSION-RETURN-SYNC */
  constructor({
    bridgeClient,
    evidenceStore,
    identityModel,
    userModel,
  }) {
    this.bridgeClient = bridgeClient;
    this.evidenceStore = evidenceStore;
    this.identityModel = identityModel;
    this.userModel = userModel;
  }

  /** @implements SPEC-DISCUSSION-RETURN-SYNC */
  async sync(userId) {
    const user = await this.userModel.findById(userId);
    if (!user?.discussion_import_consent) {
      throw Object.assign(new Error('Discussion return consent is required'), {
        code: 'DISCUSSION_IMPORT_CONSENT_REQUIRED',
        statusCode: 403,
      });
    }
    const identity = await this.identityModel.findVerifiedByProvider(userId, 'discord');
    if (!identity) {
      throw Object.assign(new Error('A verified Discord identity is required'), {
        code: 'VERIFIED_DISCORD_IDENTITY_REQUIRED',
        statusCode: 409,
      });
    }

    const current = await this.evidenceStore.list(userId, 'voices');
    const existingSourceIds = new Set();
    for (const record of current.filter(importedDiscussion)) {
      existingSourceIds.add(record.sourceRef);
      if (typeof record.comment === 'string' && record.comment.length > 0) {
        existingSourceIds.add(discussionSourceRef({
          text: record.comment,
          createdAt: record.occurredAt,
        }));
      }
    }
    const utterances = await this.bridgeClient.listUtterances({
      authorId: identity.provider_sub,
      since: latestOccurredAt(current),
    });
    const candidates = utterances.map((utterance) => ({
      ...utterance,
      sourceRef: discussionSourceRef(utterance),
    }));
    const newUtterances = candidates.filter((utterance) => {
      if (existingSourceIds.has(utterance.sourceRef)) return false;
      existingSourceIds.add(utterance.sourceRef);
      return true;
    });
    for (const utterance of newUtterances) {
      const voice = validateVoiceInput({
        gameTitle: 'Discutere',
        scopeType: 'content',
        contentName: 'Discord discussion',
        sentiment: 0,
        comment: utterance.text,
        tags: 'discussion',
      });
      await this.evidenceStore.create(userId, 'voices', {
        ...voice,
        sourceKind: 'discussion',
        sourceRef: utterance.sourceRef,
        occurredAt: utterance.createdAt,
      });
    }
    return {
      received: utterances.length,
      imported: newUtterances.length,
      duplicate: utterances.length - newUtterances.length,
    };
  }
}

module.exports = {
  DiscussionImportService,
  discussionSourceRef,
  importedDiscussion,
  latestOccurredAt,
};
