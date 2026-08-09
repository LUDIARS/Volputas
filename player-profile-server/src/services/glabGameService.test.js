const test = require('node:test');
const assert = require('node:assert/strict');
const { createGlabGameService } = require('./glabGameService');

function gameRow(overrides = {}) {
  return {
    id: '3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8',
    title: 'Uni Quest',
    team: 'GLAB 3年',
    platform: 'PC',
    description: null,
    store_url: null,
    glab_project_id: null,
    is_active: true,
    created_at: '2026-08-09T00:00:00.000Z',
    updated_at: '2026-08-09T00:00:00.000Z',
    ...overrides,
  };
}

function repository(overrides = {}) {
  return {
    list: async () => [gameRow()],
    findById: async () => gameRow(),
    create: async (input, registeredBy) => gameRow({ ...input, registered_by: registeredBy }),
    update: async (_id, patch) => gameRow(patch),
    ...overrides,
  };
}

test('the stored row is projected into the GLAB shape', async () => {
  const service = createGlabGameService({ repository: repository() });
  const [game] = await service.listGames();

  assert.equal(game.storeUrl, null);
  assert.equal(game.glabProjectId, null);
  assert.equal(game.isActive, true);
  assert.equal(game.createdAt, '2026-08-09T00:00:00.000Z');
  // 列名がそのまま漏れると GLAB のパネル契約と食い違う。
  assert.equal(Object.hasOwn(game, 'store_url'), false);
  assert.equal(Object.hasOwn(game, 'registered_by'), false);
});

test('inactive games are hidden unless the caller asks for them', async () => {
  const calls = [];
  const service = createGlabGameService({
    repository: repository({
      list: async (options) => {
        calls.push(options);
        return [];
      },
    }),
  });

  await service.listGames();
  await service.listGames({ includeInactive: true });

  assert.deepEqual(calls, [{ includeInactive: false }, { includeInactive: true }]);
});

test('a blank title is refused before it reaches the database', async () => {
  const service = createGlabGameService({
    repository: repository({
      create: async () => {
        throw new Error('must not insert');
      },
    }),
  });

  await assert.rejects(
    () => service.registerGame('admin-1', { title: '   ' }),
    (error) => error.statusCode === 400 && error.code === 'INVALID_GAME_INPUT',
  );
});

test('database-unsafe Unicode is refused before it reaches the database', async () => {
  const service = createGlabGameService({ repository: repository() });

  await assert.rejects(
    () => service.registerGame('admin-1', { title: 'unsafe\u0000title' }),
    (error) => error.code === 'INVALID_GAME_INPUT',
  );
});

test('an unknown field is refused rather than silently dropped', async () => {
  const service = createGlabGameService({ repository: repository() });

  await assert.rejects(
    () => service.registerGame('admin-1', { title: 'Uni Quest', releasedAt: '2026-08-09' }),
    (error) => error.code === 'INVALID_GAME_INPUT',
  );
});

test('a store URL must use an HTTP scheme', async () => {
  const service = createGlabGameService({ repository: repository() });

  for (const storeUrl of ['javascript:alert(document.domain)', 'not a URL']) {
    await assert.rejects(
      () => service.registerGame('admin-1', { title: 'Uni Quest', storeUrl }),
      (error) => error.code === 'INVALID_GAME_INPUT' && error.statusCode === 400,
    );
  }
});

test('a duplicate title becomes a conflict, not a 500', async () => {
  const service = createGlabGameService({
    repository: repository({
      create: async () => {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      },
    }),
  });

  await assert.rejects(
    () => service.registerGame('admin-1', { title: 'Uni Quest' }),
    (error) => error.statusCode === 409 && error.code === 'GAME_TITLE_TAKEN',
  );
});

test('an empty patch is refused so an accidental PATCH cannot pass as success', async () => {
  const service = createGlabGameService({ repository: repository() });

  await assert.rejects(
    () => service.updateGame('3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8', {}),
    (error) => error.code === 'INVALID_GAME_INPUT',
  );
});

test('a missing game updates to null instead of throwing', async () => {
  const service = createGlabGameService({
    repository: repository({ update: async () => null }),
  });

  assert.equal(
    await service.updateGame('3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8', { isActive: false }),
    null,
  );
});

test('a malformed game id is refused before the query', async () => {
  const service = createGlabGameService({
    repository: repository({
      update: async () => {
        throw new Error('must not query');
      },
    }),
  });

  await assert.rejects(
    () => service.updateGame('not-a-uuid', { isActive: false }),
    (error) => error.code === 'INVALID_GAME_ID',
  );
});
