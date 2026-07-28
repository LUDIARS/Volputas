const { randomUUID } = require('node:crypto');

const COLUMN_BY_KIND = {
  'card-sorts': 'card_sort_records',
  gameplay: 'gameplay_records',
  voices: 'voice_records',
  'emotion-curves': 'emotion_curve_records',
  comparisons: 'comparison_records',
};

function requireArray(value, column) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Cernere returned invalid ${column} data`);
  }
  return value;
}

class CernereProfileEvidenceStore {
  constructor({
    projectClient,
    userResolver,
    surveyModel,
    now = () => new Date(),
  }) {
    this.projectClient = projectClient;
    this.userResolver = userResolver;
    this.surveyModel = surveyModel;
    this.now = now;
    this.writeQueues = new Map();
  }

  async resolveOwnerId(localUserId) {
    return this.userResolver.resolve(localUserId);
  }

  async readColumns(ownerId, columns) {
    return this.projectClient.request('managed_project', 'get_user_data', {
      userId: ownerId,
      columns,
    });
  }

  async writeColumns(ownerId, data) {
    return this.projectClient.request('managed_project', 'set_user_data', {
      userId: ownerId,
      data,
    });
  }

  async list(localUserId, kind) {
    const column = COLUMN_BY_KIND[kind];
    if (!column) throw new Error(`Unsupported profile evidence kind: ${kind}`);
    const ownerId = await this.resolveOwnerId(localUserId);
    const data = await this.readColumns(ownerId, [column]);
    return requireArray(data[column], column);
  }

  async create(localUserId, kind, payload) {
    const column = COLUMN_BY_KIND[kind];
    if (!column) throw new Error(`Unsupported profile evidence kind: ${kind}`);
    return this.withWriteLock(localUserId, async () => {
      const ownerId = await this.resolveOwnerId(localUserId);
      const data = await this.readColumns(ownerId, [column]);
      const records = requireArray(data[column], column);
      const timestamp = this.now().toISOString();
      const record = {
        schemaVersion: 1,
        ...payload,
        id: randomUUID(),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await this.writeColumns(ownerId, { [column]: [record, ...records] });
      return record;
    });
  }

  async updateOwned(localUserId, kind, recordId, patch) {
    const column = COLUMN_BY_KIND[kind];
    if (!column) throw new Error(`Unsupported profile evidence kind: ${kind}`);
    return this.withWriteLock(localUserId, async () => {
      const ownerId = await this.resolveOwnerId(localUserId);
      const data = await this.readColumns(ownerId, [column]);
      const records = requireArray(data[column], column);
      const index = records.findIndex((item) => item?.id === recordId);
      if (index === -1) return null;
      const record = {
        ...records[index],
        ...patch,
        updatedAt: this.now().toISOString(),
      };
      const next = [...records];
      next[index] = record;
      await this.writeColumns(ownerId, { [column]: next });
      return record;
    });
  }

  async findOwned(localUserId, recordId) {
    const ownerId = await this.resolveOwnerId(localUserId);
    const columns = Object.values(COLUMN_BY_KIND);
    const data = await this.readColumns(ownerId, columns);
    for (const [kind, column] of Object.entries(COLUMN_BY_KIND)) {
      const record = requireArray(data[column], column).find((item) => item?.id === recordId);
      if (record) return { kind, ownerId, record };
    }
    return null;
  }

  async listSurveyResponses(localUserId) {
    const ownerId = await this.resolveOwnerId(localUserId);
    const surveys = await this.surveyModel.findActive();
    const responses = await Promise.all(surveys.map((survey) =>
      this.projectClient.request('volputas_survey', 'get_response', {
        userId: ownerId,
        surveyId: survey.id,
      })
    ));
    return responses.filter(Boolean).map((response) => ({
      survey: { id: response.surveyId },
      answers: Object.fromEntries(response.answers.map((answer) => [
        answer.questionId,
        answer.textValue ?? answer.intValue,
      ])),
      updatedAt: response.submittedAt,
    }));
  }

  async listSurveyDefinitions() {
    // Question metadata for persona analysis; the catalog itself is not
    // per-user data, so no owner resolution is involved.
    return this.surveyModel.findActive();
  }

  async listSurveyStatuses(localUserId, surveyIds) {
    const ownerId = await this.resolveOwnerId(localUserId);
    return this.projectClient.request('volputas_survey', 'list_response_statuses', {
      userId: ownerId,
      surveyIds,
    });
  }

  async getSurveyResponse(localUserId, surveyId) {
    const ownerId = await this.resolveOwnerId(localUserId);
    return this.projectClient.request('volputas_survey', 'get_response', {
      userId: ownerId,
      surveyId,
    });
  }

  async saveSurveyResponse(localUserId, surveyId, answers) {
    const ownerId = await this.resolveOwnerId(localUserId);
    return this.projectClient.request('volputas_survey', 'save_response', {
      userId: ownerId,
      surveyId,
      answers,
    });
  }

  async readAnalysis(localUserId) {
    const ownerId = await this.resolveOwnerId(localUserId);
    const data = await this.readColumns(ownerId, ['persona_analysis']);
    return data.persona_analysis || null;
  }

  async writeAnalysis(localUserId, analysis) {
    const ownerId = await this.resolveOwnerId(localUserId);
    await this.writeColumns(ownerId, { persona_analysis: analysis });
    return analysis;
  }

  async findMedia(localUserId, recordId, kind) {
    const ownerId = await this.resolveOwnerId(localUserId);
    const data = await this.readColumns(ownerId, ['profile_media']);
    return requireArray(data.profile_media, 'profile_media')
      .find((item) => item?.recordId === recordId && item?.kind === kind) || null;
  }

  async saveMedia(localUserId, metadata) {
    return this.withWriteLock(localUserId, async () => {
      const ownerId = await this.resolveOwnerId(localUserId);
      const data = await this.readColumns(ownerId, ['profile_media']);
      const current = requireArray(data.profile_media, 'profile_media')
        .filter((item) => item?.recordId !== metadata.recordId || item?.kind !== metadata.kind);
      const value = {
        ...metadata,
        storageKey: `${ownerId}/${metadata.kind}/${metadata.recordId}`,
        updatedAt: this.now().toISOString(),
      };
      await this.writeColumns(ownerId, { profile_media: [value, ...current] });
      return value;
    });
  }

  async withWriteLock(localUserId, operation) {
    const previous = this.writeQueues.get(localUserId) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.writeQueues.set(localUserId, current);
    try {
      return await current;
    } finally {
      if (this.writeQueues.get(localUserId) === current) {
        this.writeQueues.delete(localUserId);
      }
    }
  }

  close() {
    this.projectClient.close();
  }
}

module.exports = { COLUMN_BY_KIND, CernereProfileEvidenceStore, requireArray };
