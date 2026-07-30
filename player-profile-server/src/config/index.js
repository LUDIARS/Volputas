const path = require('node:path');
const { normalizeOptionalBaseUrl } = require('./baseUrl');

const port = process.env.PORT || 3000;
const frontendUrl = process.env.FRONTEND_URL || `http://localhost:${port}`;

function commaSeparated(value, fallback) {
  return (value || fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || fallback, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }
  return parsed;
}

function databaseConfig(env) {
  if (env.VOLPUTAS_DATABASE_URL?.trim()) {
    return {
      connectionString: env.VOLPUTAS_DATABASE_URL.trim(),
      max: parseInt(env.DB_POOL_MAX || '20', 10),
      connectionTimeoutMillis: 5_000,
    };
  }
  return {
    host: env.DB_HOST || 'localhost',
    port: parseInt(env.DB_PORT || '5432', 10),
    database: env.DB_NAME || 'player_profile',
    user: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD || '',
    max: parseInt(env.DB_POOL_MAX || '20', 10),
    connectionTimeoutMillis: 5_000,
  };
}

const config = {
  port,
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl,

  cernere: {
    baseUrl: normalizeOptionalBaseUrl(process.env.CERNERE_BASE_URL, 'CERNERE_BASE_URL'),
    projectClientId: process.env.CERNERE_PROJECT_CLIENT_ID?.trim() || '',
    projectClientSecret: process.env.CERNERE_PROJECT_CLIENT_SECRET || '',
    audience: normalizeOptionalBaseUrl(process.env.VOLPUTAS_AUDIENCE, 'VOLPUTAS_AUDIENCE'),
  },

  auth: {
    sources: commaSeparated(process.env.AUTH_SOURCES, 'cernere'),
  },

  redis: {
    url: process.env.REDIS_URL || '',
  },

  pseudoIdSecret: process.env.VOLUPTAS_PSEUDO_ID_SECRET || '',

  personaExport: {
    // Dedicated inbound project credential for Di. Do not reuse Cernere's
    // outbound project client secret or a user access token.
    token: process.env.VOLPUTAS_PERSONA_EXPORT_TOKEN || '',
  },

  steam: {
    apiKey: process.env.STEAM_API_KEY || '',
  },

  mediaStorage: {
    endpoint: process.env.MEDIA_S3_ENDPOINT || '',
    publicEndpoint: process.env.MEDIA_S3_PUBLIC_ENDPOINT || process.env.MEDIA_S3_ENDPOINT || '',
    region: process.env.MEDIA_S3_REGION || '',
    bucket: process.env.MEDIA_S3_BUCKET || '',
    accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY || '',
    forcePathStyle: process.env.MEDIA_S3_FORCE_PATH_STYLE !== 'false',
    uploadExpiresSeconds: positiveInteger(process.env.MEDIA_UPLOAD_EXPIRES_SECONDS, '900'),
    deliveryExpiresSeconds: positiveInteger(process.env.MEDIA_DELIVERY_EXPIRES_SECONDS, '300'),
  },

  spectator: {
    staleSessionHours: positiveInteger(process.env.SPECTATOR_STALE_SESSION_HOURS, '24'),
    maintenanceIntervalMinutes: positiveInteger(process.env.SPECTATOR_MAINTENANCE_INTERVAL_MINUTES, '60'),
  },

  mediaWorker: {
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
    antivirusPath: process.env.CLAM_SCAN_PATH || process.env.CLAMDSCAN_PATH || 'clamscan',
    pollSeconds: positiveInteger(process.env.MEDIA_WORKER_POLL_SECONDS, '5'),
    originalRetentionDays: positiveInteger(process.env.MEDIA_ORIGINAL_RETENTION_DAYS, '30'),
    workRoot: process.env.MEDIA_WORK_ROOT || '',
  },

  profileMedia: {
    root: process.env.VOLPUTAS_MEDIA_ROOT
      || path.resolve(__dirname, '../../data/profile-media'),
  },

  memoriaLink: {
    // memoria_links.token_ciphertext を AES-256-GCM で暗号化する鍵の元。 SHA-256 で32byteに正規化する。
    encryptionKey: process.env.MEMORIA_LINK_ENCRYPTION_KEY || '',
  },

  db: databaseConfig(process.env),

  jwt: {
    issuer: process.env.JWT_ISSUER || 'http://localhost:3000',
    audience: process.env.JWT_AUDIENCE || 'player-profile-client',
    accessTokenExpiresIn: '15m',
    refreshTokenExpiresInDays: 30,
  },

  oauth: {
    cernere: {
      clientId: process.env.CERNERE_OIDC_CLIENT_ID || '',
      clientSecret: process.env.CERNERE_OIDC_CLIENT_SECRET || '',
      authorizationUrl: `${(process.env.CERNERE_BASE_URL || '').replace(/\/+$/, '')}/oidc/authorize`,
      tokenUrl: `${(process.env.CERNERE_BASE_URL || '').replace(/\/+$/, '')}/oidc/token`,
      userinfoUrl: `${(process.env.CERNERE_BASE_URL || '').replace(/\/+$/, '')}/oidc/userinfo`,
      callbackUrl: process.env.CERNERE_OIDC_CALLBACK_URL
        || new URL('/auth/callback', frontendUrl).toString(),
      scopes: ['openid', 'email', 'profile'],
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/callback',
      scopes: ['openid', 'email', 'profile'],
    },
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID || '',
      clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
      authorizationUrl: 'https://discord.com/api/oauth2/authorize',
      tokenUrl: 'https://discord.com/api/oauth2/token',
      userinfoUrl: 'https://discord.com/api/users/@me',
      callbackUrl: process.env.DISCORD_CALLBACK_URL || 'http://localhost:3000/auth/callback',
      scopes: ['identify', 'email'],
    },
  },

  rateLimit: {
    login: { windowMs: 60_000, max: 5 },
    events: { windowMs: 60_000, max: 100 },
    general: { windowMs: 60_000, max: 60 },
  },

  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  },
};

module.exports = config;
