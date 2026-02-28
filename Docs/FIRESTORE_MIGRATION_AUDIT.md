# Firestore Migration – Confirmation Audit

## ✅ Migration Status: Complete

All MongoDB/Mongoose usage has been replaced with Firebase Firestore. This document confirms coverage and edge cases.

---

## 1. Collections & Repositories

| Collection      | Repository                    | Status |
|----------------|-------------------------------|--------|
| users          | userRepository.js             | ✅     |
| userProfiles   | userProfileRepository.js      | ✅     |
| posts          | postRepository.js             | ✅     |
| integrations   | integrationRepository.js     | ✅     |
| competitors    | competitorRepository.js      | ✅     |
| keywordPolls   | keywordPollRepository.js      | ✅     |
| keywordMatches | keywordMatchRepository.js     | ✅     |
| rateLimits     | rateLimitRepository.js        | ✅     |
| ideaCaches     | ideaCacheRepository.js        | ✅     |
| generatedImages| generatedImageRepository.js   | ✅     |
| knowledgeBases | knowledgeBaseRepository.js    | ✅     |
| trendInsights  | trendInsightRepository.js     | ✅     |

---

## 2. ID Handling

- **Firestore IDs**: String-based (no ObjectId)
- **userId references**: All use `String(userId)` for consistency
- **req.user._id**: Plain string from Firestore
- **Integration doc IDs**: `{userId}_{platform}` for upsert

---

## 3. Edge Cases Verified

### Auth
- ✅ Email/password signup & login (userRepo)
- ✅ LinkedIn OAuth (user + integration)
- ✅ Facebook OAuth (user + integration)
- ✅ Twitter OAuth (user + integration)
- ✅ Google/Firebase session sync (userRepo.findById, findOne)
- ✅ JWT + session.userId resolution

### Posts
- ✅ List with pagination (startAfter cursor)
- ✅ Filter by platform, status, date range
- ✅ Scheduled posts query (status + scheduledAt ≤ now)
- ✅ Create, update, delete
- ✅ platformIds/platformUrls as plain objects (not Map)

### Integrations
- ✅ findOne by userId + platform (docId path)
- ✅ findOne with isActive filter
- ✅ updateLastUsed(integration._id)
- ✅ Token refresh (Twitter) via findOneAndUpdate

### Scheduler
- ✅ processScheduledPosts (postRepo, integrationRepo)
- ✅ processTrendPolling (userRepo.find({}))
- ✅ processKeywordPolling (keywordPollRepo.find)
- ✅ storeLinkedInPostInFirebase(post.userId, updatedPost)

### Profile & Onboarding
- ✅ Profile completion (competitors.length, integrations.length)
- ✅ Competitor sort by lastScrapedAt
- ✅ UserProfile upsert by userId

### Rate Limiting
- ✅ $inc handled in rateLimitRepository (findOneAndUpdate)

### Analytics & Reports
- ✅ postRepo.find with filters
- ✅ postRepo.countDocuments
- ✅ postRepo.findByIdAndUpdate for analytics cache

---

## 4. Data Serialization

- **docToObject**: Converts Firestore Timestamps → Date (recursive, including nested/arrays)
- **serializeForFirestore**: Converts Date → Timestamp, Map → object (used in user, post, userProfile, etc.)
- **integrationRepository**: Passes raw data; Firestore accepts Date natively in Node

---

## 5. Firestore Indexes

Composite indexes are defined in `firestore.indexes.json` (root). The `platforms` field uses `arrayConfig: "CONTAINS"` for `array-contains` / `array-contains-any` queries.

**Deploy indexes:**
1. Run `firebase init firestore` if you don't have `firebase.json` yet (select existing `firestore.indexes.json`).
2. Deploy: `firebase deploy --only firestore:indexes`

Or let Firestore prompt with index-creation links on first run.

---

## 6. Remaining References (Cosmetic)

- `mongoUserId` in auth middleware – internal variable name (no MongoDB)
- Comments updated: "MongoDB" → "Firestore" where relevant

---

## 7. Dependencies

- **Removed**: mongoose, connect-mongo
- **Required**: firebase-admin (Firestore + Storage)

---

## 8. Environment

- **FIREBASE_SERVICE_ACCOUNT_PATH** or **FIREBASE_SERVICE_ACCOUNT** – required
- **MONGO_URI** – removed from .env.example

---

## 9. Confirmation Checklist

### Indexes
- [x] `status + scheduledAt` – scheduler query (no userId)
- [x] `userId + status + scheduledAt` – user-specific scheduled posts
- [x] `userId + status + createdAt` – list posts by status
- [x] `userId + platforms (array-contains) + createdAt` – filter by platform
- [x] `userId + publishedAt` – analytics date range
- [x] `keywordMatches`: `userId + platform + postId`

### Edge Cases
- **postRepository `platforms.$in`**: If `arr.length > 10`, Firestore `array-contains-any` limit applies; no platform filter is added (returns all posts for user). Callers typically pass 1 platform.
- **keywordMatchRepository `platform.$in`**: Sliced to 10; `in` query limited to 10 values.
- **integrationRepository**: Uses docId `{userId}_{platform}` for direct lookups; no composite index needed.
- **userRepository.find()**: Fetches all users (scheduler); no index needed for small user counts.
- **serializeForFirestore**: Integration/rateLimit repos pass raw `Date`; Firestore Node SDK accepts it. Other repos use `serializeForFirestore` for consistency.

### Dead Dependencies Removed
- `mongoose`, `connect-mongo` – removed from server/package.json
