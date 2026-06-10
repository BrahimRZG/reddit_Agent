/**
 * Per-install rate limiting service.
 * Spec 02: Worker Auth & Token Lifecycle.
 */

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const PURGE_PROBABILITY = 0.005;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export async function checkRateLimit(
  db: D1Database,
  installId: string,
  endpoint: string
): Promise<RateLimitResult> {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();

  const countResult = await db.prepare(
    `SELECT COUNT(*) as cnt FROM rate_limit_events
     WHERE install_id = ? AND endpoint = ? AND timestamp > ? AND action = 'allowed'`
  ).bind(installId, endpoint, windowStart).first<{ cnt: number }>();

  const count = countResult?.cnt ?? 0;

  if (count >= RATE_LIMIT_MAX_REQUESTS) {
    await logRateLimitEvent(db, installId, endpoint, 'blocked');

    const oldestResult = await db.prepare(
      `SELECT timestamp FROM rate_limit_events
       WHERE install_id = ? AND endpoint = ? AND timestamp > ? AND action = 'allowed'
       ORDER BY timestamp ASC LIMIT 1`
    ).bind(installId, endpoint, windowStart).first<{ timestamp: string }>();

    const oldestTime = oldestResult ? new Date(oldestResult.timestamp).getTime() : Date.now();
    const retryAfterMs = (oldestTime + RATE_LIMIT_WINDOW_MS) - Date.now();
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

    return { allowed: false, retryAfterSeconds };
  }

  await logRateLimitEvent(db, installId, endpoint, 'allowed');
  await maybeCleanOldEvents(db);
  return { allowed: true };
}

async function logRateLimitEvent(
  db: D1Database, installId: string, endpoint: string, action: 'allowed' | 'blocked'
): Promise<void> {
  await db.prepare(
    'INSERT INTO rate_limit_events (install_id, endpoint, timestamp, action) VALUES (?, ?, ?, ?)'
  ).bind(installId, endpoint, new Date().toISOString(), action).run();
}

async function maybeCleanOldEvents(db: D1Database): Promise<void> {
  if (Math.random() > PURGE_PROBABILITY) return;
  const cutoff = new Date(Date.now() - (RATE_LIMIT_WINDOW_MS * 2)).toISOString();
  await db.prepare('DELETE FROM rate_limit_events WHERE timestamp < ?').bind(cutoff).run();
}
