# Blazly – LinkedIn Post Automation – Architecture & Plan

## Overview

**Blazly** lets users sign in with LinkedIn (via your app **Blazly Social Media Automation**, Client ID: `86swiutwriegdi`), create posts, and schedule them. This doc covers architecture, rate limiting, and scalability for a prototype that can grow later.

---

## 1. High-Level Architecture

```
┌─────────────────┐     HTTPS      ┌─────────────────┐     REST API      ┌─────────────────┐
│   React + Vite  │ ◄────────────► │  Node.js API    │ ◄───────────────► │  LinkedIn API   │
│   (client/)     │   /api proxy   │  (server/)      │   w_member_social │  (Share posts)  │
└────────┬────────┘                └────────┬────────┘                   └─────────────────┘
         │                                  │
         │                                  │
         ▼                                  ▼
┌─────────────────┐                ┌─────────────────┐
│  Browser / SPA   │                │    MongoDB       │
│  (Session/JWT)   │                │  Users, Posts,   │
│                 │                │  Schedules       │
└─────────────────┘                └─────────────────┘
```

- **Frontend**: React + Vite in `client/`, glossy UI, talks only to your backend.
- **Backend**: Node.js (Express) in `server/`, handles auth, scheduling, and all LinkedIn calls.
- **Unified**: Single codebase with one `package.json`; `npm run dev` runs both; production serves built frontend from Express.
- **Database**: MongoDB for users, LinkedIn tokens, drafts, and scheduled posts.
- **LinkedIn**: 3-legged OAuth + Share on LinkedIn REST API (product version 202401).

---

## 2. Authentication Flow (LinkedIn 3-Legged OAuth)

1. User clicks “Sign in with LinkedIn” in your app.
2. Backend redirects to:
   `GET https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=86swiutwriegdi&redirect_uri={YOUR_CALLBACK}&state={CSRF}&scope=w_member_social`
3. User approves on LinkedIn; LinkedIn redirects to your callback with `?code=...&state=...`.
4. Backend exchanges `code` for tokens:
   `POST https://www.linkedin.com/oauth/v2/accessToken`  
   (grant_type=authorization_code, code, client_id, client_secret, redirect_uri)
5. Store in MongoDB: `access_token`, `refresh_token`, `expires_in` (60 days for access token).
6. Issue your own session (e.g. HTTP-only cookie or JWT) so the frontend identifies the user; use stored LinkedIn token only on the server for API calls.

**Redirect URI**: Must be exact HTTPS URL registered in [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps) → Your app → Auth → Redirect URLs (e.g. `https://yourapp.com/api/auth/linkedin/callback`).

---

## 3. Rate Limiting Strategy

LinkedIn enforces:

- **Application limit**: Total calls per app per 24h (UTC midnight reset).
- **Member limit**: Calls per member per app per 24h.
- **429** when limited; exact numbers are in Developer Portal → Your app → **Analytics** (after you’ve made at least one request to each endpoint).

**Our approach:**

| Layer        | What we do |
|-------------|------------|
| **App-level** | In-memory or Redis counter of outbound LinkedIn API calls per day; reject or queue new post requests when near a safe ceiling (e.g. 80% of observed limit). |
| **Per-user**  | MongoDB: count “LinkedIn API calls” per user per UTC day; before creating/scheduling a post, check count and reject with a clear message if over a threshold. |
| **Backoff**   | On 429 from LinkedIn: return 503 to client, log, and optionally retry with exponential backoff (for background jobs). |
| **Prototype** | Start with a conservative per-user limit (e.g. 10–20 posts/day) and a low app-level cap; tune after you see Analytics. |

This keeps you within LinkedIn limits and gives a path to scale (e.g. Redis + job queue later).

---

## 4. Core Backend Modules

| Module           | Responsibility |
|-----------------|----------------|
| **Auth**        | LinkedIn OAuth (authorize URL, callback, token exchange), session/JWT, optional “me” profile fetch. |
| **Users**       | MongoDB model: `linkedinId`, tokens (encrypted or in a secrets store), profile snapshot. |
| **Posts**       | Create draft, “post now” (call LinkedIn `/rest/posts` CREATE), and “schedule” (save to DB + job). |
| **Scheduler**   | Cron or in-process job that runs every minute (or 5), finds `scheduledAt ≤ now` and not yet sent, calls LinkedIn API, updates status, increments rate-limit counters. |
| **LinkedIn client** | Single place that does all HTTP to LinkedIn (token refresh if needed, 429 handling, logging). |
| **Rate limiter**    | Before any LinkedIn call: check app + user daily usage; after call: increment counters. |

---

## 5. Database (MongoDB) – Collections

- **users**  
  `linkedinId`, `accessToken`, `refreshToken`, `tokenExpiresAt`, `profile` (name, picture, etc.), `createdAt`, `updatedAt`.

- **posts**  
  `userId`, `content` (text), `visibility` (e.g. PUBLIC), `status`: `draft` | `scheduled` | `published` | `failed`, `scheduledAt`, `publishedAt`, `linkedinPostUrn`, `error` (if failed), `createdAt`, `updatedAt`.

- **rate_limits** (optional but recommended)  
  `date` (UTC day), `userId` or `app`, `count` – for daily app and per-user limits.

Indexes: `users.linkedinId` (unique), `posts.userId` + `posts.status`, `posts.scheduledAt` (for scheduler), `rate_limits.date` + `userId`/app.

---

## 6. API Endpoints (Backend)

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/auth/linkedin`           | Redirect to LinkedIn authorize URL. |
| GET    | `/api/auth/linkedin/callback`  | Handle `code`, exchange token, create/update user, set session, redirect to frontend. |
| POST   | `/api/auth/logout`             | Clear session. |
| GET    | `/api/me`                      | Current user + LinkedIn profile (from DB or LinkedIn). |
| POST   | `/api/posts`                   | Create draft or “post now” (body: content, schedule?: datetime). |
| GET    | `/api/posts`                   | List user’s posts (drafts, scheduled, published). |
| PATCH  | `/api/posts/:id`               | Update draft or reschedule. |
| DELETE | `/api/posts/:id`               | Delete draft/scheduled; optional: delete on LinkedIn if already published. |

---

## 7. Frontend (React + Vite)

- **Glossy, simple UI**: One main dashboard after login – “New post”, “Scheduled”, “Published” (and drafts).
- **Screens**:  
  - Landing + “Sign in with LinkedIn”.  
  - Post composer: text area, “Post now” / “Schedule” (with datetime picker).  
  - List of posts with status and actions (edit draft, cancel scheduled).
- **Auth**: Call `/api/auth/linkedin` to start OAuth; after callback, backend redirects to app with session; frontend calls `/api/me` and `/api/posts` with credentials (cookies or Authorization header).
- **Vite**: Proxy `/api` to Node backend in dev for a single-origin feel.

---

## 8. Scalability (Later, Beyond Prototype)

- **Tokens**: Move secrets to env or a vault; consider encrypting tokens at rest in MongoDB.
- **Scheduler**: Move to a proper job queue (Bull/BullMQ + Redis) and a worker process; run multiple workers if needed.
- **Rate limits**: Store counters in Redis for speed and multi-instance safety.
- **API**: Add rate limiting on your own API (e.g. express-rate-limit) to protect backend and LinkedIn.
- **Refresh tokens**: LinkedIn may support programmatic refresh for partners; when available, refresh in background before expiry instead of re-prompting user.

---

## 9. Tech Stack Summary

| Layer    | Choice        | Notes |
|----------|---------------|--------|
| Frontend | React + Vite  | Glossy UI, simple UX. |
| Backend  | Node.js (Express) | REST API, auth, scheduler. |
| DB       | MongoDB       | Users, posts, optional rate_limits. |
| Auth     | LinkedIn OAuth 2.0 (3-legged), scope `w_member_social`. |
| LinkedIn API | Share on LinkedIn, REST, product version 202401. |

---

## 10. Security Checklist

- [ ] Client secret only on server; never in frontend or repo.
- [ ] Redirect URI exact match; validate `state` on callback (CSRF).
- [ ] Store tokens securely; in production consider encryption at rest.
- [ ] HTTPS only in production for callback and app.
- [ ] Session cookie: HTTP-only, Secure, SameSite.

---

Next step: implement the prototype (backend + frontend + DB models and one scheduler loop) following this architecture, with conservative rate limits and a clear path to the improvements above.
