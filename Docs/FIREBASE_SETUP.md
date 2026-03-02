# Firebase Setup (No SDK / No Service Account)

This project uses Firebase **without** the Firebase Admin SDK and **without** a service account JSON file.

## Architecture

| Component | Implementation |
|-----------|----------------|
| **Firestore** | `@google-cloud/firestore` with Application Default Credentials |
| **Auth (token verify)** | JWT verification via `firebaseTokenVerify.js` (Google public keys) |
| **Storage** | Client uploads directly to Firebase Storage (no backend) |

## Setup

### 1. Application Default Credentials

For local development and production (e.g. Vercel, GCP):

```bash
gcloud auth application-default login
```

Select project: `blazly-social-51a89`

### 2. Environment Variables

```env
FIREBASE_PROJECT_ID=blazly-social-51a89
```

### 3. Client (Firebase SDK)

The client still uses the Firebase JS SDK for:
- **Auth**: Email/password, Google sign-in
- **Storage**: Direct uploads (images for Instagram/Facebook posting)

Set in `.env`:
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=blazly-social-51a89.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=blazly-social-51a89
VITE_FIREBASE_STORAGE_BUCKET=blazly-social-51a89.firebasestorage.app
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
```

### 4. Storage Rules

Images uploaded to Firebase Storage are publicly readable (required for Instagram/Facebook to fetch them). See `storage.rules`.

**Deploy storage rules** (required after changes):

```bash
firebase deploy --only storage
```

If you see "User does not have permission" errors, ensure rules are deployed and the path matches `uploads/{userId}/{fileName}`.

### 5. Firestore Rules

See `firestore.rules` for collection-level rules. Deploy with:

```bash
firebase deploy --only firestore:rules
```

## Image Posting Flow

1. User uploads image → Client uploads to Firebase Storage → Returns public URL
2. Client sends URL to server → Server passes URL to Instagram/Facebook/LinkedIn/Twitter/Threads APIs
3. Platforms fetch the image from the public URL

Firebase Storage URLs (`https://firebasestorage.googleapis.com/...` or `https://*.firebasestorage.app/...`) are already absolute and work for all platforms.
