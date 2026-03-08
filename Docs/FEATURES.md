# Blazly — Feature Documentation

> **Version**: 1.0  
> **Last updated**: March 2026  
> **Stack**: React + Express + Firebase + Vercel

---

## Table of Contents

1. [Authentication & Onboarding](#1-authentication--onboarding)
2. [Home & Post Composer](#2-home--post-composer)
3. [Posts & Reports](#3-posts--reports)
4. [Analytics Report](#4-analytics-report)
5. [Keyword Alerts](#5-keyword-alerts)
6. [Ideas](#6-ideas)
7. [Content Planner](#7-content-planner)
8. [Inbox](#8-inbox)
9. [Integrations](#9-integrations)
10. [Competitor Analysis](#10-competitor-analysis)
11. [Profile & Profile Optimizer](#11-profile--profile-optimizer)
12. [AI Capabilities](#12-ai-capabilities)
13. [Platform Support Matrix](#13-platform-support-matrix)

---

## 1. Authentication & Onboarding

### Sign Up / Sign In
- Email + password registration with validation
- Google OAuth one-click sign-in
- Friendly error messages for common issues (wrong password, email already in use, weak password, etc.)
- Persistent sessions via Firebase Auth

### Onboarding (4-step wizard)
| Step | Description |
|------|-------------|
| 1 — Basic Info | Name and timezone selection |
| 2 — Business Details | Business name entry |
| 3 — Business Profile Scraper | Website URL input; automatic brand extraction |
| 4 — AI Profile & Connect | Connect social accounts (LinkedIn, Facebook, Threads, Instagram; X after setup) |

**Website Scraper (Step 3)**
- Checks `sitemap.xml` first to scrape multiple pages for richer brand context
- Falls back to direct page scraping if no sitemap found
- Retries up to 3 times with exponential backoff (1s → 2s → 4s)
- 10-minute timeout with abort signal
- Shows real-time status: "Checking sitemap…", spinner with URL in grey, retry countdown
- Graceful handling of 403/bot-blocking (retries with browser User-Agent)
- Skips retries for invalid URLs (bad format, 4xx responses)
- "Next" button disabled while scraping is in progress

**Onboarding Platform Connect**
- All platforms except X (Twitter) can be connected during onboarding
- X (Twitter) is intentionally disabled with a note to connect post-setup (requires active browser session)
- OAuth popups open in separate windows; main onboarding flow is unblocked

---

## 2. Home & Post Composer

### Dashboard (no platform selected)
- Welcome message with connected account count
- Stats cards: Scheduled posts, Published posts, Connected integrations
- Quick Actions grid: Create Post, Content Calendar, View Posts, Edit Profile
- CTA to connect accounts if none are connected

### Platform View (platform selected from sidebar)
- Profile header showing connected account name, avatar, and a Disconnect button
- Inline Post Composer
- Recent Posts list with pagination ("Load More")

### Post Composer
**Media types supported:**
- Text only
- Single image (uploaded file or URL)
- Single video (uploaded file or URL)
- Carousel (multiple images/videos — auto-detected when >1 file selected)

**Content input:**
- Free-text textarea with per-platform character limit enforcement
  - LinkedIn: 3,000 chars
  - Twitter/X: 280 chars
  - Instagram: 2,200 chars
  - Facebook: 63,206 chars
  - Threads: 500 chars
- Character counter with over-limit warning

**Media handling:**
- File picker with `multiple` selection (uploads all files to Firebase Storage)
- URL paste input for remote images/videos
- Thumbnail gallery with individual remove buttons
- AI-generated image support (see §12)

**Posting options:**
- Post Now — publishes immediately to selected platform(s)
- Schedule — date/time picker with timezone selector; AI best-time suggestions shown
- Platform selector — toggle buttons for each connected integration (multi-platform post)

**Workflow:**
- Draft auto-saved to `sessionStorage` (survives page refresh)
- Posting overlay blocks UI during submission to prevent double-posts
- Per-platform success/failure result shown after submission
- Successful posts saved to Firestore for analytics tracking
- Post URLs shown after publishing with direct links

**LinkedIn-specific UI:**
- Mimics LinkedIn's native composer (avatar, "Start a post" trigger bar)
- "Media" quick-action button to open file picker directly

---

## 3. Posts & Reports

### Posts Page (`/posts`)
- Full post history list
- Filters: platform, status (published / scheduled / failed), date range
- Export options: CSV, JSON, PDF/Print
- Per-post actions: View (opens platform URL), Delete
- Shows platform icon badge on each post card

---

## 4. Analytics Report

### Page (`/report`)

**Overview chart**
- Combined multi-platform line chart (Impressions / Likes / Comments — selectable)
- Only renders lines for platforms you are connected to or have posts on
- YAxis label shows the selected metric name
- Tooltip shows "Platform: value" for each platform on hover
- Date range filter (custom From / To) or "All time" checkbox

**Per-platform mini-charts**
- One card per connected platform or platform with posts
- "Connected" badge for active integrations
- Shows flat line at 0 if posts exist but analytics not yet refreshed
- Contextual placeholder:
  - "2 LinkedIn posts found. Click 'Refresh analytics' to load engagement data."
  - "No LinkedIn posts yet. Publish a post to see analytics."
- Inline metric legend

**Post history**
- Expandable post cards showing analytics per platform
- Displays: Impressions, Likes, Comments, Engagement, Retweets, Replies, Views, Reposts

**Actions**
- **Refresh analytics** — fetches live data from all platform APIs for up to 30 posts; persists to Firestore
- **Download CSV** — exports the current report data
- Hint banner prompts refresh when posts have no analytics yet

**Platform analytics sources:**
| Platform | Metrics fetched |
|----------|----------------|
| LinkedIn | Impressions, likes, comments |
| Instagram | Impressions, likes, comments (via Graph API insights) |
| Facebook | Impressions, engaged users, reactions |
| Twitter/X | Impressions, likes, retweets, replies |
| Threads | Views, likes, replies, reposts, quotes (via /insights endpoint) |

---

## 5. Keyword Alerts

### Page (`/keyword-alerts`)
- Add keywords/phrases to monitor across social platforms
- Keywords also sourced from your saved brand profile keywords

**Per-platform behavior:**
| Platform | Search method |
|----------|--------------|
| Twitter/X | v2 recent search API |
| LinkedIn | Feed search |
| Facebook | Public page post search |
| Instagram | Hashtag search (Business account + Public Content Access required) |
| Threads | Not available (no public search API) |

- Results displayed in-app with match count
- Keyword matches stored to database
- In-app notification shown if Instagram direct-login token cannot perform hashtag search

---

## 6. Ideas

### Page (`/ideas`)
- AI-generated content ideas based on your brand profile, keywords, and industry
- Filtered by content type: Text, Image/Reel, Carousel

**"Use this idea" behaviour by type:**
| Content Type | Action |
|-------------|--------|
| Text | Opens AI Content Generator with idea pre-filled as prompt |
| Reel / Video | Opens Post Composer with idea text pre-filled |
| Carousel | Opens Post Composer with idea text pre-filled |

- Ideas do NOT post automatically — user must review and explicitly click Post
- AI generates full caption + hashtags from the idea prompt

---

## 7. Content Planner

### Page (`/planner`)
- Calendar view of scheduled and published posts
- Click a date to see posts scheduled for that day
- Create new scheduled posts directly from the calendar
- Navigate months forward/backward

---

## 8. Inbox

### Page (`/inbox`)
- Unified inbox aggregating comments and messages from all connected platforms

**Per-platform sources:**
| Platform | Data fetched |
|----------|-------------|
| Facebook | Page comments on posts |
| Instagram | Post comments + direct messages |
| Twitter/X | Mentions and replies |
| LinkedIn | Post comments (via Community Management API if configured) |
| Threads | Thread replies |

- Reply to comments inline
- Token refresh handled automatically for Twitter and Threads sessions
- Graceful degradation: if a platform returns permission errors, others still load

---

## 9. Integrations

### Page (`/integrations`)
**Supported platforms:**
| Platform | OAuth Flow | Notes |
|----------|-----------|-------|
| LinkedIn | OAuth 2.0 | Analytics require API approval |
| Facebook | OAuth 2.0 | Includes page selection; Instagram linked via Facebook |
| Twitter / X | OAuth 2.0 + PKCE | Requires active X session in browser; warning shown |
| Threads | OAuth 2.0 → long-lived token | user_id stored as string (large integer safe) |
| Instagram | OAuth 2.0 (Business Login API) | Requires Business/Creator account |

**UX features:**
- OAuth opens in a popup window (main app stays open)
- Multiple integrations can be initiated without waiting for each to complete
- On successful OAuth, integration saved to Firestore and sidebar updates live
- Disconnect button per platform with confirmation dialog
- X (Twitter) card shows amber warning: "Make sure you are already logged into X in this browser before clicking Connect"

---

## 10. Competitor Analysis

### Page (`/competitors`)
- Add competitor websites and social media profile links
- AI scrapes and analyses each competitor's public presence

**Analysis includes:**
- Business summary
- Brand tone
- Industry
- Target audience
- Value proposition
- Social media metrics (posting frequency, engagement, interaction types)
- Story and comment activity (where public)

**Idea generation:**
- AI generates content ideas inspired by competitor strategy and your brand profile

**Storage:**
- Competitor data persisted to Firestore (client-side, sanitised)
- Re-scrape button to refresh stale competitor data

---

## 11. Profile & Profile Optimizer

### Profile Page (`/profile`)
- View and edit account info (name, timezone, password)
- Business profile: name, website, summary, brand tone, keywords, industry, target audience, value proposition
- Re-run website scraper from profile page
- View connected integrations and competitor list

### Profile Optimizer
- AI analyses your connected social profiles against best practices
- Per-platform suggestions: bio length, keyword usage, profile picture, post frequency
- Suggestions shown per platform with actionable tips
- Uses client-supplied integration tokens (no server-side credential dependency)

---

## 12. AI Capabilities

| Feature | Description |
|---------|-------------|
| **Brand analysis** | Extracts business name, summary, tone, keywords, industry from website content |
| **Content generation** | Writes platform-optimised captions + hashtags from a topic prompt |
| **Image generation** | Generates images from a text description; auto-uploaded to Firebase Storage |
| **Best-time suggestions** | Recommends optimal posting times per platform |
| **Competitor ideas** | Generates content ideas informed by competitor analysis |
| **Profile optimisation** | Audit suggestions per connected social platform |
| **Idea generation** | Suggests content ideas based on brand keywords and industry |

**AI provider:** Google Gemini  
**Image provider:** Gemini image generation (base64 → Firebase Storage)

---

## 13. Platform Support Matrix

| Feature | LinkedIn | Facebook | Instagram | Twitter/X | Threads |
|---------|:--------:|:--------:|:---------:|:---------:|:-------:|
| Text post | ✅ | ✅ | ✅ | ✅ | ✅ |
| Image post | ✅ | ✅ | ✅ | ✅ | ✅ |
| Video post | ✅ | ✅ | ✅ | ✅ | ✅ |
| Carousel | ✅ | ✅ | ✅ | ❌ | ✅ |
| Schedule post | ✅ | ✅ | ✅ | ✅ | ✅ |
| Analytics | ⏳* | ✅ | ✅ | ✅ | ✅ |
| Inbox (comments) | ⏳* | ✅ | ✅ | ✅ | ✅ |
| Keyword alerts | ✅ | ✅ | ⚠️** | ✅ | ❌ |
| Competitor scrape | ✅ | ✅ | ✅ | ✅ | ✅ |

> ⏳\* LinkedIn analytics and inbox require Community Management API approval (submitted)  
> ⚠️\*\* Instagram hashtag search requires Business account + Public Content Access permission

---

## Deployment

| Layer | Platform |
|-------|---------|
| Frontend | Vercel (static, `public/` output) |
| Backend API | Vercel Serverless (`api/server.js` → Express) |
| Database | Firestore (client-side SDK; no server-side credentials required) |
| File storage | Firebase Storage (client-side direct upload) |
| Auth | Firebase Authentication |
| Scheduled jobs | Vercel Cron Jobs |

**Key env vars required in Vercel:**

```
FRONTEND_URL=https://social.blazly.ai
INSTAGRAM_APP_ID=<your Meta app ID>
INSTAGRAM_APP_SECRET=<your Meta app secret>
INSTAGRAM_REDIRECT_URI=https://social.blazly.ai/api/auth/integrations/instagram/callback
LINKEDIN_CLIENT_ID=...
LINKEDIN_CLIENT_SECRET=...
LINKEDIN_REDIRECT_URI=https://social.blazly.ai/api/auth/integrations/linkedin/callback
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
TWITTER_CLIENT_ID=...
TWITTER_CLIENT_SECRET=...
THREADS_APP_ID=...
THREADS_APP_SECRET=...
THREADS_REDIRECT_URI=https://social.blazly.ai/api/auth/integrations/threads/callback
GEMINI_API_KEY=...
JWT_SECRET=...
SESSION_SECRET=...
FIREBASE_PROJECT_ID=...
```
