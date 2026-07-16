const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SteamServiceError,
  extractVanityOrId,
  resolveSteamId64,
  fetchPlayerSummary,
  fetchOwnedGames,
} = require('./steamService');

function withFetch(handler, fn) {
  const original = global.fetch;
  global.fetch = handler;
  return fn().finally(() => {
    global.fetch = original;
  });
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

test('extractVanityOrId recognizes SteamID64, profile URLs and vanity URLs', () => {
  assert.deepEqual(extractVanityOrId('76561198000000000'), { id64: '76561198000000000' });
  assert.deepEqual(
    extractVanityOrId('https://steamcommunity.com/profiles/76561198000000001'),
    { id64: '76561198000000001' }
  );
  assert.deepEqual(
    extractVanityOrId('https://steamcommunity.com/id/somevanity/'),
    { vanity: 'somevanity' }
  );
  assert.deepEqual(extractVanityOrId('somevanity'), { vanity: 'somevanity' });
});

test('resolveSteamId64 returns a 17-digit SteamID64 without calling the API', async () => {
  await withFetch(() => {
    throw new Error('fetch should not be called');
  }, async () => {
    const id = await resolveSteamId64('76561198000000000', 'unused-key');
    assert.equal(id, '76561198000000000');
  });
});

test('resolveSteamId64 resolves a vanity name via the Steam API', async () => {
  await withFetch(
    async () => jsonResponse({ response: { success: 1, steamid: '76561198000000002' } }),
    async () => {
      const id = await resolveSteamId64('somevanity', 'test-key');
      assert.equal(id, '76561198000000002');
    }
  );
});

test('resolveSteamId64 throws STEAM_RESOLVE_FAILED when the vanity name is unknown', async () => {
  await withFetch(
    async () => jsonResponse({ response: { success: 42 } }),
    async () => {
      await assert.rejects(
        () => resolveSteamId64('unknown-vanity', 'test-key'),
        (err) => err instanceof SteamServiceError && err.code === 'STEAM_RESOLVE_FAILED'
      );
    }
  );
});

test('resolveSteamId64 throws STEAM_NOT_CONFIGURED for vanity input without an API key', async () => {
  await assert.rejects(
    () => resolveSteamId64('somevanity', ''),
    (err) => err instanceof SteamServiceError && err.code === 'STEAM_NOT_CONFIGURED'
  );
});

test('fetchPlayerSummary maps the Steam player summary fields', async () => {
  await withFetch(
    async () => jsonResponse({
      response: {
        players: [{
          steamid: '76561198000000000',
          personaname: 'Example',
          avatarfull: 'https://example.com/avatar.jpg',
          profileurl: 'https://steamcommunity.com/id/somevanity/',
          communityvisibilitystate: 3,
        }],
      },
    }),
    async () => {
      const summary = await fetchPlayerSummary('76561198000000000', 'test-key');
      assert.deepEqual(summary, {
        steamId64: '76561198000000000',
        personaName: 'Example',
        avatarUrl: 'https://example.com/avatar.jpg',
        profileUrl: 'https://steamcommunity.com/id/somevanity/',
        visibilityState: 3,
      });
    }
  );
});

test('fetchPlayerSummary throws STEAM_PROFILE_NOT_FOUND when no player is returned', async () => {
  await withFetch(
    async () => jsonResponse({ response: { players: [] } }),
    async () => {
      await assert.rejects(
        () => fetchPlayerSummary('76561198000000000', 'test-key'),
        (err) => err instanceof SteamServiceError && err.code === 'STEAM_PROFILE_NOT_FOUND'
      );
    }
  );
});

test('fetchOwnedGames maps owned games and defaults missing playtime to 0', async () => {
  await withFetch(
    async () => jsonResponse({
      response: {
        game_count: 1,
        games: [{ appid: 440, name: 'Team Fortress 2', playtime_forever: 120, img_icon_url: 'abc' }],
      },
    }),
    async () => {
      const games = await fetchOwnedGames('76561198000000000', 'test-key');
      assert.deepEqual(games, [{
        appId: 440,
        name: 'Team Fortress 2',
        playtimeForeverMinutes: 120,
        playtime2WeeksMinutes: 0,
        imgIconUrl: 'abc',
      }]);
    }
  );
});

test('fetchOwnedGames returns an empty list when the game details are private', async () => {
  await withFetch(
    async () => jsonResponse({ response: {} }),
    async () => {
      const games = await fetchOwnedGames('76561198000000000', 'test-key');
      assert.deepEqual(games, []);
    }
  );
});
