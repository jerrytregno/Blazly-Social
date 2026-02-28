/**
 * Dev server – runs Express with node-cron scheduler.
 * For Vercel, the app is exported from src/server.js; crons run via api/cron/*.
 */
import { connectDb } from './db.js';
import { config } from './config.js';
import { startScheduler } from './scheduler.js';
import app from './app.js';

await connectDb();
startScheduler();

app.listen(config.port, () => {
  console.log(`Blazly API running at http://localhost:${config.port}`);
});
