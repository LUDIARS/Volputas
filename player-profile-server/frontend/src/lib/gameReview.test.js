import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeGameReviewInput, submitGameReview } from './gameReview.js';

describe('game review', () => {
  it('normalizes reviews for developed and commercial games', () => {
    assert.deepEqual(normalizeGameReviewInput({
      gameName: '  My Game  ',
      gameKind: 'developed',
      rating: '4',
      text: '  楽しかったです。  ',
    }), {
      gameName: 'My Game',
      gameKind: 'developed',
      rating: 4,
      text: '楽しかったです。',
    });
    assert.equal(normalizeGameReviewInput({
      gameName: '市販ゲーム',
      gameKind: 'commercial',
      rating: 5,
      text: 'レビュー',
    }).gameKind, 'commercial');
  });

  it('rejects incomplete or out-of-range reviews', () => {
    assert.throws(
      () => normalizeGameReviewInput({ gameName: '', gameKind: 'developed', rating: 5, text: '本文' }),
      /ゲーム名/,
    );
    assert.throws(
      () => normalizeGameReviewInput({ gameName: 'Game', gameKind: 'other', rating: 5, text: '本文' }),
      /区分/,
    );
    assert.throws(
      () => normalizeGameReviewInput({ gameName: 'Game', gameKind: 'commercial', rating: 6, text: '本文' }),
      /評価/,
    );
    assert.throws(
      () => normalizeGameReviewInput({ gameName: 'Game', gameKind: 'commercial', rating: 5, text: ' ' }),
      /レビュー本文/,
    );
  });

  it('posts a text-only impression using the Voluptas session format', async () => {
    const calls = [];
    const request = async (path, options) => {
      calls.push({ path, options });
      if (path === '/api/v1/sessions') return { data: { id: 'session-1' } };
      if (path.endsWith('/impressions')) return { data: { id: 'impression-1' } };
      return { data: {} };
    };

    const result = await submitGameReview({
      gameName: 'Commercial Game',
      gameKind: 'commercial',
      rating: 3,
      text: '遊びやすいゲームでした。',
    }, request);

    assert.equal(result, 'impression-1');
    assert.deepEqual(calls.map(({ path, options }) => [path, options.method]), [
      ['/api/v1/sessions', 'POST'],
      ['/api/v1/sessions/session-1/impressions', 'POST'],
      ['/api/v1/impressions/impression-1/complete', 'POST'],
      ['/api/v1/sessions/session-1', 'PATCH'],
    ]);
    assert.deepEqual(calls[0].options.body, {
      game_id: 'Commercial Game',
      metadata: {
        source: 'volputas_web_game_review',
        game_kind: 'commercial',
      },
    });
    assert.equal(calls[1].options.body.client.rating, 3);
    assert.equal(calls[1].options.body.client.game_kind, 'commercial');
    assert.deepEqual(calls[1].options.body.assets, []);
  });
});
