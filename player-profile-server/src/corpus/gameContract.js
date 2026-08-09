// ゲームマスタの入出力契約。
//
// 設問契約 (corpus/surveyContract) と同じ方針で、 「保存前の入力検証」 と
// 「保存済み行を GLAB へ返す形」 の両方をここに集約する。 route と service は
// 検証結果を受け取るだけにして、 検証規則が複数箇所へ散らないようにする。
const { z } = require('zod');
const { AppError } = require('../middleware/errorHandler');
const { hasUnpairedSurrogate } = require('./surveyContract');

const uuidSchema = z.string().uuid().transform((value) => value.toLowerCase());
const databaseText = (schema) => schema.refine(
  (value) => !value.includes('\u0000') && !hasUnpairedSurrogate(value),
  'text contains unsupported Unicode',
);

const optionalText = (max) => databaseText(z.string().trim().max(max)).nullish().transform(
  (value) => (value === undefined || value === null || value === '' ? null : value),
);

function usesHttpProtocol(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const gameInputSchema = z.object({
  title: databaseText(z.string().trim().min(1).max(200)),
  team: optionalText(200),
  platform: optionalText(120),
  description: optionalText(4_000),
  // 外部リンクは表示のためにそのまま出すので、 スキーム込みで妥当な URL に限る。
  storeUrl: z.string().trim().url().max(500).refine(
    usesHttpProtocol,
    'store URL must use http or https',
  ).nullish().transform(
    (value) => (value === undefined || value === null || value === '' ? null : value),
  ),
  glabProjectId: optionalText(200),
  isActive: z.boolean().default(true),
}).strict();

// 更新は部分適用。 未指定の項目を null で潰さないよう、 明示されたキーだけを返す。
// 既定値付きの項目 (isActive) を .partial() で流用すると、 空ボディでも既定値が
// 補われて「何も指定していない PATCH」が成功してしまうため、 更新側では既定を
// 外した定義を持つ。
const gameUpdateSchema = gameInputSchema
  .omit({ isActive: true })
  .extend({ isActive: z.boolean() })
  .partial()
  .strict();

function invalidInput(error) {
  return new AppError(
    400,
    'INVALID_GAME_INPUT',
    Object.entries(error.flatten().fieldErrors)
      .map(([field, messages]) => `${field}: ${messages.join(', ')}`)
      .join('; ') || 'Invalid game input',
  );
}

function validateGameInput(body) {
  const parsed = gameInputSchema.safeParse(body ?? {});
  if (!parsed.success) throw invalidInput(parsed.error);
  return parsed.data;
}

function validateGameUpdate(body) {
  const parsed = gameUpdateSchema.safeParse(body ?? {});
  if (!parsed.success) throw invalidInput(parsed.error);
  if (Object.keys(parsed.data).length === 0) {
    throw new AppError(400, 'INVALID_GAME_INPUT', 'No updatable fields were provided');
  }
  return parsed.data;
}

function validateGameId(value) {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new AppError(400, 'INVALID_GAME_ID', 'Invalid game ID');
  return parsed.data;
}

// 一覧の game_id 絞り込み用。 未指定 (絞り込みなし) と不正値を区別する。
function validateOptionalGameId(value) {
  if (value === undefined || value === null || value === '') return null;
  return validateGameId(value);
}

function gameView(row) {
  return {
    id: row.id,
    title: row.title,
    team: row.team,
    platform: row.platform,
    description: row.description,
    storeUrl: row.store_url,
    glabProjectId: row.glab_project_id,
    isActive: row.is_active,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

module.exports = {
  gameView,
  validateGameId,
  validateGameInput,
  validateGameUpdate,
  validateOptionalGameId,
};
