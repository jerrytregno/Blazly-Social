/**
 * Vercel Cron: trend polling (runs every 30 min).
 */
import { processTrendPolling } from '../../server/src/scheduler.js';
import { connectDb } from '../../server/src/db.js';

export const config = {
  maxDuration: 120,
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const auth = req.headers.authorization;
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    await connectDb();
    await processTrendPolling();
    res.json({ ok: true });
  } catch (err) {
    console.error('[cron] trend-poll:', err);
    res.status(500).json({ error: err.message });
  }
}
