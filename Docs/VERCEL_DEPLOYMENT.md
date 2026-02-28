# Vercel Deployment

This codebase is structured for deployment on [Vercel](https://vercel.com).

## Structure

```
/
├── api/
│   └── cron/                 # Vercel Cron endpoints
│       ├── scheduled-posts.js
│       ├── trend-poll.js
│       └── keyword-poll.js
├── client/                   # React frontend (Vite)
├── server/                   # Express backend
│   └── src/
│       ├── app.js            # Express app (no listen)
│       ├── index.js          # Dev server (listen + node-cron)
│       ├── routes/
│       ├── services/
│       └── db/
├── src/
│   └── server.js             # Vercel entry – exports Express app
├── public/                   # Build output (generated, gitignored)
├── vercel.json
└── package.json
```

## How It Works

- **Express**: Exported from `src/server.js`. Vercel auto-detects it and deploys as a serverless function.
- **Static**: Vite builds to `public/`. Vercel serves it from CDN.
- **SPA**: Non-API routes are rewritten to `/index.html` for client-side routing.
- **Crons**: `node-cron` is replaced by Vercel Cron Jobs that hit `/api/cron/*` endpoints.

## Deploy Steps

1. **Connect repo** to Vercel (GitHub/GitLab/Bitbucket).

2. **Environment variables** – set in Vercel Project Settings:
   - `FIREBASE_SERVICE_ACCOUNT` or `FIREBASE_SERVICE_ACCOUNT_PATH` (required)
   - `FRONTEND_URL` = your Vercel URL (e.g. `https://yourapp.vercel.app`)
   - `SESSION_SECRET`, `JWT_SECRET`
   - `CRON_SECRET` (optional; Vercel injects `Authorization: Bearer <CRON_SECRET>` for cron invocations)
   - OAuth: `LINKEDIN_CLIENT_SECRET`, `FACEBOOK_APP_SECRET`, `TWITTER_*`, `INSTAGRAM_*`, etc.
   - `GEMINI_API_KEY`, `API_PUBLIC_URL`

3. **Build** – Vercel runs `npm run build` (Vite → `public/`).

4. **Deploy** – `vercel` or push to main.

## Local Development

```bash
npm run dev          # Vite + Express (node-cron scheduler)
npm run build        # Build frontend to public/
npm run start        # Production mode (serves from public/)
```

## Cron Schedule

| Endpoint | Schedule |
|---------|----------|
| `/api/cron/scheduled-posts` | Every minute |
| `/api/cron/trend-poll` | Every 30 min |
| `/api/cron/keyword-poll` | Every hour |

Cron endpoints require `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is set. Vercel adds this automatically for cron invocations.
