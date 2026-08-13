const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreUtterance } = require('./affectMapping');

test('scores stay inside the emotion-curve entry ranges', () => {
  for (const text of ['これは最高に楽しい！！', 'つまらないしストレスたまる', 'ドアを開けた']) {
    const score = scoreUtterance(text);
    assert.ok(score.valence >= -2 && score.valence <= 2, `valence for ${text}: ${score.valence}`);
    assert.ok(score.arousal >= 1 && score.arousal <= 5, `arousal for ${text}: ${score.arousal}`);
  }
});

test('positive and negative wording map to opposite valence signs', () => {
  const positive = scoreUtterance('これは最高に楽しい！！神ゲーだ！');
  const negative = scoreUtterance('最悪だ、つまらない、二度とやらない');
  assert.ok(positive.valence > 0, `positive: ${positive.valence}`);
  assert.ok(negative.valence < 0, `negative: ${negative.valence}`);
  assert.ok(positive.hasSignal && negative.hasSignal);
});

test('flat narration carries no affect signal', () => {
  const flat = scoreUtterance('ドアを開けた');
  assert.equal(flat.valence, 0);
  assert.equal(flat.hasSignal, false);
});
