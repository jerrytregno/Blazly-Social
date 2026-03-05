/**
 * Vercel serverless catch-all handler.
 *
 * Routes all /api/* requests to the Express app.
 * Vercel's file-system routing gives priority to specific files, so
 * /api/cron/*.js functions still take precedence over this dynamic catch-all.
 *
 * Routing priority (Vercel):
 *   1. /api/cron/scheduled-posts.js  ← static file, wins for  /api/cron/scheduled-posts
 *   2. /api/[...path].js             ← catch-all, handles everything else under /api/
 */
import app from '../server/src/app.js';

export default function handler(req, res) {
  return app(req, res);
}
