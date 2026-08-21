const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GAME_LOG_EXCERPT_LIMIT,
  SYSTEM_PROMPT,
  buildEvaluationPrompt,
} = require('./emotionCurveEvaluationPrompt');
const { EmotionCurveEvaluationService } = require('./emotionCurveEvaluationService');

const RECORD = {
  id: 'curve-1',
  gameTitle: 'Example Quest',
  sessionLabel: '初回プレイ',
  narrativeArc: '導入',
  journeyStage: '認知',
  playContext: '就寝前に30分',
  daysAfterPlay: 1,
  totalPlaytimeHours: 12,
  sessionPlaytimeMinutes: 45,
  entries: [
    { timeSeconds: 30, stamp: 'hype', valence: 2, arousal: 5, comment: '' },
    { timeSeconds: 95, stamp: 'stress', valence: -2, arousal: 5, comment: 'UI がわかりにくい' },
  ],
};

const PERSONA = {
  analyzedAt: '2026-07-27T00:00:00.000Z',
  axes: {
    narrative: { label: '物語志向', score: 80, evidenceWeight: 4 },
    social: { label: '共有・交流志向', score: 0, evidenceWeight: 0 },
  },
  leadingAxes: [{ id: 'narrative', label: '物語志向', score: 80, evidenceWeight: 4 }],
};

test('evaluation prompt cites stamps, playtime, persona, and truncates game logs', () => {
  const prompt = buildEvaluationPrompt({
    record: RECORD,
    persona: PERSONA,
    gameLogText: 'x'.repeat(GAME_LOG_EXCERPT_LIMIT + 500),
  });
  assert.match(prompt, /0:30 スタンプ: 盛り上がり/);
  assert.match(prompt, /1:35 スタンプ: ストレス .* メモ: UI がわかりにくい/);
  assert.match(prompt, /通算プレイ時間: 12 時間/);
  assert.match(prompt, /このセッションのプレイ時間: 45 分/);
  assert.match(prompt, /物語志向: 80\/100/);
  assert.match(prompt, /ゲームログ \(抜粋、先頭のみ\)/);
  // Weightless axes must not be presented as evidence.
  assert.doesNotMatch(prompt, /共有・交流志向/);
  assert.ok(prompt.includes('x'.repeat(GAME_LOG_EXCERPT_LIMIT)));
  assert.ok(!prompt.includes('x'.repeat(GAME_LOG_EXCERPT_LIMIT + 1)));
});

test('evaluation prompt marks missing persona analysis explicitly', () => {
  const prompt = buildEvaluationPrompt({ record: RECORD, persona: null, gameLogText: null });
  assert.match(prompt, /ペルソナ分析は未実施/);
  assert.doesNotMatch(prompt, /## ゲームログ/);
});

test('evaluation service wraps LLM output with provenance metadata', async () => {
  const calls = [];
  const service = new EmotionCurveEvaluationService({
    llmClient: {
      isConfigured: () => true,
      generate: async (input) => {
        calls.push(input);
        return {
          text: '## 分析結果\n## 西洋の判定 (機序)\n- 確度: 高\n## 東洋の判定 (全体観)\n- 確度: 中\n## 合議\n一致度: 中',
          model: 'claude-opus-5',
        };
      },
    },
    now: () => new Date('2026-07-27T12:00:00.000Z'),
  });

  const evaluation = await service.evaluate({
    record: RECORD,
    persona: PERSONA,
    gameLogText: 'boss_defeated t=95',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].system, SYSTEM_PROMPT);
  assert.match(calls[0].prompt, /boss_defeated t=95/);
  assert.match(calls[0].prompt, /# 二流派の判定/);
  assert.match(calls[0].prompt, /## 西洋の判定 \(機序\)/);
  assert.match(calls[0].prompt, /## 東洋の判定 \(全体観\)/);
  assert.match(calls[0].prompt, /## 合議/);
  const { judgments, ...rest } = evaluation;
  assert.deepEqual(rest, {
    schemaVersion: 2,
    extractor: 'llm',
    model: 'claude-opus-5',
    text: '## 分析結果\n## 西洋の判定 (機序)\n- 確度: 高\n## 東洋の判定 (全体観)\n- 確度: 中\n## 合議\n一致度: 中',
    evaluatedAt: '2026-07-27T12:00:00.000Z',
    personaAnalyzedAt: PERSONA.analyzedAt,
    usedGameLog: true,
  });
  assert.equal(judgments.complete, true);
  assert.equal(judgments.western.confidence, '高');
  assert.equal(judgments.eastern.confidence, '中');
  assert.equal(judgments.agreement, '中');
});

test('evaluation service propagates LLM configuration errors', async () => {
  const service = new EmotionCurveEvaluationService({
    llmClient: {
      isConfigured: () => false,
      generate: async () => {
        throw Object.assign(new Error('LLM is not configured'), {
          code: 'LLM_NOT_CONFIGURED',
          statusCode: 503,
        });
      },
    },
  });
  await assert.rejects(
    service.evaluate({ record: RECORD, persona: null, gameLogText: null }),
    (error) => error.code === 'LLM_NOT_CONFIGURED'
  );
});
