/**
 * Nonce replay protection service.
 * Spec 02: Worker Auth & Token Lifecycle.
 */

const NONCE_TTL_MS = 600_000; // 10 minutes
const PURGE_PROBABILITY = 0.01;

export async function isNonceUsed(db: D1Database, nonce: string): Promise<boolean> {
  const row = await db.prepare(
    'SELECT 1 FROM nonce_log WHERE nonce = ?'
  ).bind(nonce).first();
  return row !== null;
}

export async function insertNonce(
  db: D1Database,
  nonce: string,
  installId: string
): Promise<void> {
  await db.prepare(
    'INSERT INTO nonce_log (nonce, install_id, created_at) VALUES (?, ?, ?)'
  ).bind(nonce, installId, new Date().toISOString()).run();
}

export async function maybeCleanExpiredNonces(db: D1Database): Promise<void> {
  if (Math.random() > PURGE_PROBABILITY) return;
  const cutoff = new Date(Date.now() - NONCE_TTL_MS).toISOString();
  await db.prepare('DELETE FROM nonce_log WHERE created_at < ?').bind(cutoff).run();
}
