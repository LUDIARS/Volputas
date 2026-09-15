const { z } = require('zod');

const timestamp = z.number().finite().nonnegative();
const recordSchema = z.object({
  source: z.enum(['youtube', 'youtube-livechat', 'steam']),
  nativeId: z.string().min(1).max(500), authorId: z.string().min(1).max(500),
  content: z.string().trim().min(1).max(100000), gameSlug: z.string().min(1),
  threadKey: z.string().min(1), sourceUrl: z.string().url(),
  postedAt: timestamp, fetchedAt: timestamp, expiresAt: timestamp,
  signal: z.object({ votedUp: z.boolean().optional(), upvotes: z.number().finite().optional() }).optional(),
});
const snapshotSchema = z.object({
  schemaVersion: z.literal(1), generatedAt: timestamp, windowStart: timestamp, expiresAt: timestamp,
  records: z.array(recordSchema).max(500000),
  coverage: z.array(z.object({
    kind: z.enum(['comments', 'replies', 'livechat', 'steam']), target: z.string(),
    videoId: z.string().optional(), startedAt: timestamp,
    status: z.enum(['pending', 'complete', 'unavailable', 'error']),
    detail: z.string().optional(), gaps: z.array(z.string()).optional(),
  })),
});

function parseHistorySnapshot(input, now) {
  const snapshot = snapshotSchema.parse(input);
  if (!Number.isFinite(now) || snapshot.generatedAt > now || snapshot.windowStart > snapshot.generatedAt ||
      snapshot.expiresAt <= now || snapshot.expiresAt > snapshot.generatedAt + 30 * 86400000) {
    throw new Error('History snapshot is expired or has an invalid observation window');
  }
  for (const row of snapshot.records) {
    if (row.postedAt < snapshot.windowStart || row.postedAt > snapshot.generatedAt ||
        row.fetchedAt < row.postedAt || row.fetchedAt > snapshot.generatedAt || row.expiresAt < snapshot.expiresAt ||
        row.expiresAt <= now || row.authorId === 'unknown') {
      throw new Error('History record has invalid identity, timestamps or expiry');
    }
    if (row.source === 'youtube-livechat') {
      const job = snapshot.coverage.find(item => item.kind === 'livechat' && item.target === row.threadKey);
      if (!job || row.postedAt < job.startedAt) throw new Error('Live chat record predates collection');
    }
  }
  return snapshot;
}

module.exports = { parseHistorySnapshot };
