/**
 * Vercel serverless entry point for the Express app.
 *
 * All /api/* requests are routed here via the rewrite in vercel.json.
 * /api/cron/* requests bypass this because Vercel matches their specific
 * function files BEFORE applying rewrites (filesystem routing wins).
 */
import app from '../server/src/app.js';

export default function handler(req, res) {
  return app(req, res);
}
