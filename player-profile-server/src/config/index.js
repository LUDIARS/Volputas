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

const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  auth: {
    sources: commaSeparated(process.env.AUTH_SOURCES, 'google,discord'),
  },

  redis: {
    url: process.env.REDIS_URL || '',
  },

  pseudoIdSecret: process.env.VOLUPTAS_PSEUDO_ID_SECRET || '',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'player_profile',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
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

  jwt: {
    issuer: process.env.JWT_ISSUER || 'http://localhost:3000',
    audience: process.env.JWT_AUDIENCE || 'player-profile-client',
    accessTokenExpiresIn: '15m',
    refreshTokenExpiresInDays: 30,
  },

  oauth: {
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
