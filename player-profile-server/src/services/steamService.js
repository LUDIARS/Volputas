const config = require('../config');

const RESOLVE_VANITY_URL = 'https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/';
const PLAYER_SUMMARIES_URL = 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/';
const OWNED_GAMES_URL = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/';

class SteamServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function extractVanityOrId(input) {
  const trimmed = String(input || '').trim();
  const profileMatch = trimmed.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  if (profileMatch) return { id64: profileMatch[1] };
  const vanityMatch = trimmed.match(/steamcommunity\.com\/id\/([^/?#]+)/i);
  if (vanityMatch) return { vanity: vanityMatch[1] };
  if (/^\d{17}$/.test(trimmed)) return { id64: trimmed };
  return { vanity: trimmed };
}

function requireApiKey(apiKey) {
  if (!apiKey) throw new SteamServiceError('STEAM_NOT_CONFIGURED', 'STEAM_API_KEY is not configured');
}

async function steamFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new SteamServiceError('STEAM_API_ERROR', `Steam API error (${res.status})`);
  return res.json();
}

// Accepts a raw SteamID64, a vanity name, or a full profile URL of either form.
async function resolveSteamId64(input, apiKey = config.steam.apiKey) {
  const parsed = extractVanityOrId(input);
  if (parsed.id64) return parsed.id64;

  requireApiKey(apiKey);
  const url = new URL(RESOLVE_VANITY_URL);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('vanityurl', parsed.vanity);
  const json = await steamFetch(url);
  if (json?.response?.success !== 1 || !json.response.steamid) {
    throw new SteamServiceError('STEAM_RESOLVE_FAILED', 'Could not resolve Steam ID from the given input');
  }
  return json.response.steamid;
}

async function fetchPlayerSummary(steamId64, apiKey = config.steam.apiKey) {
  requireApiKey(apiKey);
  const url = new URL(PLAYER_SUMMARIES_URL);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('steamids', steamId64);
  const json = await steamFetch(url);
  const player = json?.response?.players?.[0];
  if (!player) throw new SteamServiceError('STEAM_PROFILE_NOT_FOUND', 'Steam profile not found');
  return {
    steamId64: player.steamid,
    personaName: player.personaname || null,
    avatarUrl: player.avatarfull || player.avatarmedium || player.avatar || null,
    profileUrl: player.profileurl || null,
    visibilityState: player.communityvisibilitystate ?? null,
  };
}

// Returns [] when the game-details privacy setting hides the library (distinct from the
// basic-profile visibility checked in fetchPlayerSummary).
async function fetchOwnedGames(steamId64, apiKey = config.steam.apiKey) {
  requireApiKey(apiKey);
  const url = new URL(OWNED_GAMES_URL);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('steamid', steamId64);
  url.searchParams.set('include_appinfo', '1');
  url.searchParams.set('include_played_free_games', '1');
  const json = await steamFetch(url);
  const games = json?.response?.games;
  if (!Array.isArray(games)) return [];
  return games.map((g) => ({
    appId: g.appid,
    name: g.name || `App ${g.appid}`,
    playtimeForeverMinutes: g.playtime_forever || 0,
    playtime2WeeksMinutes: g.playtime_2weeks || 0,
    imgIconUrl: g.img_icon_url || null,
  }));
}

module.exports = {
  SteamServiceError,
  extractVanityOrId,
  resolveSteamId64,
  fetchPlayerSummary,
  fetchOwnedGames,
};
