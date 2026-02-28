# Blazly Database Schema (MongoDB)

This document describes the MongoDB schema used by the Blazly social media automation application. All collections use Mongoose with `timestamps: true` (adds `createdAt` and `updatedAt`).

---

## Collections Overview

| Collection | Purpose |
|------------|---------|
| `users` | User accounts (email, Firebase, or session auth) |
| `userprofiles` | Extended business/profile data per user |
| `integrations` | OAuth connections to social platforms |
| `posts` | Scheduled and published posts |
| `generatedimages` | AI-generated image history |
| `ratelimits` | Daily API usage limits (e.g. LinkedIn) |
| `competitors` | Competitor analysis data |
| `knowledgebases` | Scraped/structured content for AI |
| `trendinsights` | Trend data and AI suggestions |
| `keywordpolls` | Keyword monitoring config per user |
| `keywordmatches` | Keyword matches found on platforms |

---

## 1. User

**Collection:** `users`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId | auto | - | Primary key |
| `name` | String | no | - | Display name |
| `email` | String | no | - | Unique, sparse (nullable) |
| `firebaseUid` | String | no | - | Firebase auth UID (Google sign-in), unique, sparse |
| `facebookId` | String | no | - | Facebook OAuth user ID, unique, sparse |
| `twitterId` | String | no | - | Twitter/X OAuth user ID, unique, sparse |
| `password` | String | no | - | Bcrypt hash (email/password auth) |
| `timezone` | String | no | `'UTC'` | User timezone |
| `profileCompletion` | Number | no | `0` | 0–100 completion score |
| `onboardingStep` | Number | no | `1` | 1–5 onboarding progress |
| `profile.firstName` | String | no | - | First name |
| `profile.lastName` | String | no | - | Last name |
| `profile.profilePicture` | String | no | - | Avatar URL |
| `settings.theme` | String | no | `'light'` | UI theme |
| `settings.notifications` | Boolean | no | `true` | Enable notifications |
| `settings.emailContentSuggestions` | Boolean | no | `false` | Email for content ideas |
| `settings.notificationEmail` | String | no | - | Email for notifications |
| `settings.inboxAutoReply` | Boolean | no | `false` | Auto-reply to inbox |
| `aiInstructions.global` | String | no | `''` | Global AI instructions |
| `aiInstructions.useGlobalForAll` | Boolean | no | `true` | Use global for all platforms |
| `aiInstructions.platforms.linkedin` | String | no | - | Platform-specific AI instructions |
| `aiInstructions.platforms.twitter` | String | no | - | |
| `aiInstructions.platforms.instagram` | String | no | - | |
| `aiInstructions.platforms.facebook` | String | no | - | |
| `aiInstructions.platforms.threads` | String | no | - | |
| `createdAt` | Date | auto | - | Creation timestamp |
| `updatedAt` | Date | auto | - | Last update timestamp |

**Indexes:** `firebaseUid` (sparse, unique), `email` (sparse, unique), `facebookId` (sparse, unique), `twitterId` (sparse, unique), `createdAt` (-1)

---

## 2. UserProfile

**Collection:** `userprofiles`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId | auto | - | Primary key |
| `userId` | ObjectId | yes | - | Ref: User, unique |
| `businessName` | String | no | - | Business name |
| `websiteUrl` | String | no | - | Website URL |
| `businessSummary` | String | no | - | Business description |
| `brandTone` | String | no | - | Brand voice/tone |
| `keywords` | [String] | no | - | Content keywords |
| `industry` | String | no | - | Industry |
| `aiRefinedSummary` | String | no | - | AI-generated summary |
| `targetAudience` | String | no | - | Target audience |
| `valueProposition` | String | no | - | Value proposition |
| `editable` | Boolean | no | `true` | Whether profile is editable |
| `lastScrapedAt` | Date | no | - | Last scrape time |
| `customScraperApiUrl` | String | no | - | Custom scraper API |
| `createdAt` | Date | auto | - | Creation timestamp |
| `updatedAt` | Date | auto | - | Last update timestamp |

**Indexes:** `userId` (unique)

---

## 3. Integration

**Collection:** `integrations`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId | auto | - | Primary key |
| `userId` | ObjectId | yes | - | Ref: User, indexed |
| `platform` | String | yes | - | `linkedin`, `facebook`, `twitter`, `threads`, `instagram` |
| `platformUserId` | String | no | - | Platform user ID |
| `platformUsername` | String | no | - | Platform username |
| `accessToken` | String | yes | - | OAuth access token |
| `accessTokenSecret` | String | no | - | Twitter OAuth 1.0a secret |
| `refreshToken` | String | no | - | OAuth 2.0 refresh token |
| `tokenExpiresAt` | Date | no | - | Access token expiry |
| `facebookPageId` | String | no | - | Selected Facebook Page ID |
| `facebookPageAccessToken` | String | no | - | Page access token |
| `facebookPageName` | String | no | - | Page name |
| `instagramBusinessAccountId` | String | no | - | IG Business account ID |
| `instagramPageId` | String | no | - | Linked Facebook Page ID |
| `instagramPageAccessToken` | String | no | - | IG Page token |
| `profile.name` | String | no | - | Display name on platform |
| `profile.username` | String | no | - | Username |
| `profile.profilePicture` | String | no | - | Avatar URL |
| `profile.email` | String | no | - | Email |
| `isActive` | Boolean | no | `true` | Integration active |
| `lastUsedAt` | Date | no | - | Last API call |
| `createdAt` | Date | auto | - | Creation timestamp |
| `updatedAt` | Date | auto | - | Last update timestamp |

**Indexes:**
- `userId` (single)
- `platform` (single)
- `{ userId: 1, platform: 1 }` (compound, unique)

**Virtual:** `id` → `_id.toString()` (for API responses)

**Stripped in toJSON:** `accessToken`, `accessTokenSecret`, `refreshToken`, `facebookPageAccessToken`, `instagramPageAccessToken`

---

## 4. Post

**Collection:** `posts`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId | auto | - | Primary key |
| `userId` | ObjectId | yes | - | Ref: User |
| `content` | String | yes | - | Post text/caption |
| `visibility` | String | no | `'PUBLIC'` | `PUBLIC`, `CONNECTIONS` (LinkedIn) |
| `status` | String | no | `'draft'` | `draft`, `scheduled`, `published`, `failed` |
| `scheduledAt` | Date | no | - | When to publish |
| `publishedAt` | Date | no | - | When published |
| `linkedinPostUrn` | String | no | - | Legacy LinkedIn URN |
| `platforms` | [String] | no | - | `linkedin`, `facebook`, `twitter`, `threads`, `instagram` |
| `mediaType` | String | no | `'text'` | `text`, `image`, `video`, `carousel` |
| `imageUrl` | String | no | - | Single image URL |
| `videoUrl` | String | no | - | Video URL |
| `mediaItems` | [{ type, url }] | no | - | Carousel items |
| `platformIds` | Map<String,String> | no | - | platform → post ID |
| `platformUrls` | Map<String,String> | no | - | platform → post URL |
| `errors` | [{ platform, error }] | no | - | Per-platform errors |
| `analytics` | Map<String,Mixed> | no | - | platform → { impressions, likes, comments, engagement, … } |
| `analyticsFetchedAt` | Date | no | - | Last analytics fetch time |
| `createdAt` | Date | auto | - | Creation timestamp |
| `updatedAt` | Date | auto | - | Last update timestamp |

**Indexes:**
- `{ userId: 1, status: 1 }`
- `{ status: 1, scheduledAt: 1 }`

---

## 5. GeneratedImage

**Collection:** `generatedimages`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId | auto | - | Primary key |
| `userId` | ObjectId | yes | - | Ref: User |
| `prompt` | String | yes | - | AI image prompt |
| `url` | String | yes | - | Stored image path/URL |
| `createdAt` | Date | auto | - | Creation timestamp |
| `updatedAt` | Date | auto | - | Last update timestamp |

**Indexes:** `{ userId: 1, createdAt: -1 }`

---

## 6. RateLimit

**Collection:** `ratelimits`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId | auto | - | Primary key |
| `date` | String | yes | - | `YYYY-MM-DD` (UTC) |
| `key` | String | yes | - | `'app'` or userId |
| `count` | Number | no | `0` | Usage count |
| `createdAt` | Date | auto | - | Creation timestamp |
| `updatedAt` | Date | auto | - | Last update timestamp |

**Indexes:** `{ date: 1, key: 1 }` (unique)

---

## 7. Competitor

**Collection:** `competitors`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId | auto | - | Primary key |
| `userId` | ObjectId | yes | - | Ref: User |
| `competitorName` | String | yes | - | Competitor name |
| `competitorUrl` | String | yes | - | Website/source URL |
| `socialLinks` | Map<String,String> | no | - | platform → social profile URL |
| `socialActivityReport` | Object | no | - | summary, postFrequency, engagementLevel, platformActivity, lastAnalyzedAt |
| `rawScrapedData` | Mixed | no | - | Raw scraped content |
| `aiAnalysis.ideology` | String | no | - | AI analysis fields |
| `aiAnalysis.positioning` | String | no | - | |
| `aiAnalysis.strengths` | [String] | no | - | |
| `aiAnalysis.differentiators` | [String] | no | - | |
| `aiAnalysis.sustainabilityModel` | String | no | - | |
| `aiAnalysis.messagingTone` | String | no | - | |
| `aiAnalysis.contentStyle` | String | no | - | |
| `aiAnalysis.keyProducts` | [String] | no | - | |
| `aiAnalysis.pricingStrategy` | String | no | - | |
| `aiAnalysis.targetAudience` | String | no | - | |
| `aiAnalysis.technicalStack` | String | no | - | |
| `aiAnalysis.socialProof` | String | no | - | |
| `aiAnalysis.strengthsVsYou` | String | no | - | |
| `aiAnalysis.opportunityGap` | String | no | - | |
| `lastScrapedAt` | Date | no | - | Last scrape time |
| `createdAt` | Date | auto | - | Creation timestamp |
| `updatedAt` | Date | auto | - | Last update timestamp |

**Indexes:** `userId`

---

## 8. KnowledgeBase

**Collection:** `knowledgebases`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId | auto | - | Primary key |
| `userId` | ObjectId | yes | - | Ref: User |
| `type` | String | yes | - | `self`, `competitor` |
| `sourceUrl` | String | no | - | Source URL |
| `extractedText` | String | no | - | Extracted text |
| `structuredData` | Mixed | no | - | Structured content |
| `createdAt` | Date | auto | - | Creation timestamp |
| `updatedAt` | Date | auto | - | Last update timestamp |

**Indexes:** `{ userId: 1, type: 1 }`

---

## 9. TrendInsight

**Collection:** `trendinsights`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `_id` | ObjectId | auto | - | Primary key |
| `userId` | ObjectId | yes | - | Ref: User |
| `keywords` | [String] | no | - | Tracked keywords |
| `trendData` | Mixed | no | - | Raw trend data |
| `aiSuggestion.postIdea` | String | no | - | AI post idea |
| `aiSuggestion.strategySuggestion` | String | no | - | Strategy tip |
| `aiSuggestion.alertMessage` | String | no | - | Alert text |
| `read` | Boolean | no | `false` | User has read |
| `createdAt` | Date | auto | - | Creation timestamp |
| `updatedAt` | Date | auto | - | Last update timestamp |

**Indexes:** `{ userId: 1, createdAt: -1 }`

---

## Entity Relationship Diagram

```
User (1) ──────< (N) Integration
User (1) ──────< (N) Post
User (1) ──────< (N) GeneratedImage
User (1) ──────< (N) Competitor
User (1) ──────< (N) KnowledgeBase
User (1) ──────< (N) TrendInsight
User (1) ──────  (1) UserProfile
```

---

## Notes

- **Mongoose reserved path:** The `errors` field on `Post` triggers a Mongoose warning; consider renaming to `platformErrors` if needed.
- **Duplicate index warning:** Some schemas use both `index: true` on fields and `schema.index()`; remove duplicates to silence warnings.
- **Sensitive fields:** `Integration` strips tokens in `toJSON`; `User` strips `password`.
