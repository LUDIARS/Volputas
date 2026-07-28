const { validateVoiceInput } = require('./profileEvidenceSchemas');

function importedDiscussion(record) {
  return record?.sourceKind === 'discussion'
    && typeof record.sourceRef === 'string'
    && typeof record.occurredAt === 'string';
}

function latestOccurredAt(records) {
  return (records || [])
    .filter(importedDiscussion)
    .reduce((latest, record) => {
      const timestamp = Date.parse(record.occurredAt);
      return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
    }, 0);
}

class DiscussionImportService {
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
    const existingSourceIds = new Set(
      current.filter(importedDiscussion).map((record) => record.sourceRef)
    );
    const utterances = await this.bridgeClient.listUtterances({
      authorId: identity.provider_sub,
      since: latestOccurredAt(current),
    });
    const newUtterances = utterances.filter((utterance) => !existingSourceIds.has(utterance.id));
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
        sourceRef: utterance.id,
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
  importedDiscussion,
  latestOccurredAt,
};
