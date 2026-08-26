import { exec, q } from './db.js';
import { sha256 } from './util.js';

/** Sliding-window rate limit backed by rate_events. Returns true if ALLOWED. */
export async function rateAllow(actorRaw: string, kind: string, max: number, windowMinutes: number): Promise<boolean> {
  const actor = sha256(actorRaw);
  const rows = await q<{ n: number }>(
    'SELECT COUNT(*) AS n FROM rate_events WHERE actor = ? AND kind = ? AND ts > UTC_TIMESTAMP() - INTERVAL ? MINUTE',
    [actor, kind, windowMinutes],
  );
  if (Number(rows[0].n) >= max) return false;
  await exec('INSERT INTO rate_events (actor, kind) VALUES (?, ?)', [actor, kind]);
  // Opportunistic cleanup (cheap, keeps the table tiny).
  if (Math.random() < 0.02) {
    await exec('DELETE FROM rate_events WHERE ts < UTC_TIMESTAMP() - INTERVAL 2 DAY');
  }
  return true;
}
