const test = require('node:test');
const assert = require('node:assert/strict');
const { LENSES, SYNTHESIS_HEADING, buildDualLensInstructions } = require('./judgmentLenses');
const { parseJudgmentSections } = require('./judgmentSections');

test('instructions are deterministic and carry both lens headings plus the synthesis', () => {
  const first = buildDualLensInstructions({ subject: 'このゲームの改善' });
  assert.equal(first, buildDualLensInstructions({ subject: 'このゲームの改善' }));
  assert.match(first, /このゲームの改善について/);
  assert.ok(first.includes(LENSES.western.heading));
  assert.ok(first.includes(LENSES.eastern.heading));
  assert.ok(first.includes(SYNTHESIS_HEADING));
  assert.ok(first.indexOf(LENSES.western.heading) < first.indexOf(LENSES.eastern.heading));
  assert.ok(first.indexOf(LENSES.eastern.heading) < first.indexOf(SYNTHESIS_HEADING));
  assert.match(first, /一致度: 高/);
  assert.match(buildDualLensInstructions({}), /この体験について/);
});

test('sections are cut at the fixed headings with confidence and agreement', () => {
  const text = [
    '# 全体所見',
    'ここは本文。',
    '',
    '## 西洋の判定 (機序)',
    '- 機序: ピーク・エンド則',
    '- 根拠: 終端の感情価 -1.2',
    '- 確度: 高',
    '',
    '## 東洋の判定 (全体観)',
    '- 読み: 中盤の「嫌い」連打の後に盛り上がりが来ない',
    '- 確度: 中',
    '',
    '## 合議',
    '一致度: 中',
    '- 一致: 終盤の報酬不足',
    '- 食い違い: 中盤の操作性',
  ].join('\n');
  const parsed = parseJudgmentSections(text);
  assert.equal(parsed.complete, true);
  assert.equal(parsed.western.confidence, '高');
  assert.match(parsed.western.text, /ピーク・エンド則/);
  assert.equal(parsed.eastern.confidence, '中');
  assert.doesNotMatch(parsed.eastern.text, /合議/);
  assert.equal(parsed.agreement, '中');
  assert.match(parsed.synthesis, /終盤の報酬不足/);
});

test('heading level, full-width parentheses and bold markers are tolerated', () => {
  const text = [
    '### 西洋の判定（機序）',
    '確度：低',
    '**東洋の判定 (全体観)**',
    '読み: なんとなく重い',
    '### 合議',
    '- 一致度: 低',
  ].join('\n');
  const parsed = parseJudgmentSections(text);
  assert.equal(parsed.complete, true);
  assert.equal(parsed.western.confidence, '低');
  assert.match(parsed.eastern.text, /なんとなく重い/);
  assert.equal(parsed.agreement, '低');
});

test('a lens section never swallows the next when the model drops the space after ##', () => {
  const text = [
    '##西洋の判定 (機序)',
    '- 機序: フロー',
    '- 確度: 高',
    '##東洋の判定 (全体観)',
    '- 読み: 中盤が重い',
    '- 確度: 低',
    '##合議',
    '一致度: 中',
  ].join('\n');
  const parsed = parseJudgmentSections(text);
  assert.equal(parsed.complete, true);
  assert.doesNotMatch(parsed.western.text, /東洋|合議|一致度/);
  assert.equal(parsed.western.confidence, '高');
  assert.doesNotMatch(parsed.eastern.text, /合議|一致度/);
  assert.equal(parsed.eastern.confidence, '低');
  assert.equal(parsed.agreement, '中');
});

test('agreement is read from the head of the synthesis, with a full-width colon allowed', () => {
  assert.equal(parseJudgmentSections('## 合議\n一致度：高').agreement, '高');
  // A 一致度 buried in later prose does not stand in for a missing declaration.
  const buried = parseJudgmentSections('## 合議\n- 一致: 終盤の報酬不足\n- 一致度: 高');
  assert.equal(buried.agreement, null);
});

test('missing parts are null, never guessed', () => {
  const parsed = parseJudgmentSections('# 所見\n西洋も東洋も書かれていない。');
  assert.equal(parsed.complete, false);
  assert.equal(parsed.western, null);
  assert.equal(parsed.eastern, null);
  assert.equal(parsed.synthesis, null);
  assert.equal(parsed.agreement, null);
  const partial = parseJudgmentSections('## 合議\n一致度: とても高い');
  assert.equal(partial.agreement, null);
  assert.equal(parseJudgmentSections(null).complete, false);
});
