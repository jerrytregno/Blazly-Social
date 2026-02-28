# Blazly – Social Media Automation

Create and schedule posts across LinkedIn, Instagram, Twitter, and more. Users sign in with LinkedIn (your app **Blazly Social Media Automation**), write posts, post now or schedule for later. Rate limiting and Firebase Firestore are built in; the UI is simple and glossy.

## Architecture

- **Backend**: Node.js (Express), Firebase Firestore (database), LinkedIn OAuth 2.0 (3-legged), Share on LinkedIn (UGC Post API), in-app rate limiting, cron-based scheduler.
- **Frontend**: React + Vite, dark glossy UI, proxy to API in dev.
- **Unified**: Single codebase with `client/` (React) and `server/` (Express). One `npm install`, one `npm run dev`.
- **Docs**: See [ARCHITECTURE.md](./Docs/ARCHITECTURE.md) for the full plan, rate limits, and scalability notes.

## Prerequisites

- **Node.js** 18+
- **Firebase** project with Firestore (set `FIREBASE_SERVICE_ACCOUNT_PATH` or `FIREBASE_SERVICE_ACCOUNT` in `.env`)
- **LinkedIn Developer App**  
  - App: Blazly Social Media Automation (Client ID: `86swiutwriegdi`)  
  - Products: Share on LinkedIn (`w_member_social`)  
  - In [Developer Portal](https://www.linkedin.com/developers/apps) → Your app → **Auth**: add redirect URL  
    - Local: `https://localhost:5173/api/auth/linkedin/callback`  
  - Copy **Client Secret** from the Auth tab (never commit it).

## Quick start

### 1. Setup

```bash
cp .env.example .env
# Edit .env: set LINKEDIN_CLIENT_SECRET, SESSION_SECRET, FIREBASE_SERVICE_ACCOUNT_PATH, etc.
npm install
```

### 2. Run

```bash
npm run dev
```

This starts both:
- **API** at http://localhost:4000
- **App** at https://localhost:5173 (Vite dev server proxies `/api` to the backend)

### 3. Use the app

1. Open https://localhost:5173
2. Click **Sign in with LinkedIn** (redirects to LinkedIn, then back to the app)
3. On the dashboard: write a post, choose **Post now** or **Schedule** (date/time)
4. Scheduled posts are published by the backend cron every minute (see `server/src/scheduler.js`)

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Run client + server concurrently (dev) |
| `npm run dev:client` | Run Vite dev server only |
| `npm run dev:server` | Run Express API only |
| `npm run build` | Build frontend for production |
| `npm run start` | Run production server (serves built frontend + API) |

## Environment

| Variable | Description |
|----------|-------------|
| `PORT` | API port (default `4000`) |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Path to Firebase service account JSON (or use `FIREBASE_SERVICE_ACCOUNT` for JSON string) |
| `FRONTEND_URL` | Frontend origin for CORS and OAuth redirect (e.g. `https://localhost:5173`) |
| `LINKEDIN_CLIENT_ID` | LinkedIn app Client ID |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn app Client Secret (**required**) |
| `LINKEDIN_REDIRECT_URI` | Must match a redirect URL in the LinkedIn app |
| `SESSION_SECRET` | Secret for signing session cookies |
| `VITE_*` | Frontend env vars (Firebase, etc.) – exposed to client |

## Project layout

```
├── ARCHITECTURE.md    # Plan, auth flow, rate limits, scalability
├── README.md          # This file
├── .env.example       # Env template
├── package.json       # Unified deps + scripts
├── client/            # React + Vite frontend
│   ├── index.html
│   ├── vite.config.js
│   ├── public/
│   └── src/
│       ├── main.jsx, App.jsx, index.css
│       ├── hooks/useAuth.js
│       ├── pages/
│       └── components/
└── server/            # Express + MongoDB backend
    ├── uploads/       # Uploaded images
    └── src/
        ├── config.js
        ├── db.js
        ├── index.js
        ├── middleware/auth.js
        ├── models/
        ├── routes/
        ├── scheduler.js
        └── services/
```

## Production

```bash
npm run build
npm run start
```

- Set `NODE_ENV=production`
- Set `FRONTEND_URL` and `LINKEDIN_REDIRECT_URI` to your HTTPS URL
- Set `API_PUBLIC_URL` for image URLs (Instagram/LinkedIn fetch images)
- Store secrets in env or vault (never in repo)

## License

Private / use as you need.
