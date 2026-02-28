# Firebase Setup Guide for Blazly

This guide covers Firebase Console configuration for Blazly: Authentication (Google), Realtime Database, and Firestore.

**Note:** AI-generated images use **server storage** (local `uploads/` folder), not Firebase Storage. Set `API_PUBLIC_URL` in `.env` to your deployed server URL so Instagram/LinkedIn can fetch images.

---

## 1. Firebase Console Access

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select project: **blazly-social-51a89**

---

## 2. Google Authentication

1. In Firebase Console, go to **Build → Authentication**
2. Click **Get started** if not already enabled
3. Open **Sign-in method**
4. Click **Google** → Enable → Set **Project support email** → Save

**Authorized domains**: Ensure `localhost` is listed for local dev. Add your production domain when deploying.

### Fix "api-key-not-valid" Error

If you see `auth/api-key-not-valid` when signing in with Google:

1. **Get the correct API key** from Firebase Console → **Project Settings** (gear) → **General** → Your apps → **Web app** → copy the `apiKey` value.

2. **Add to** `frontend/.env`:
   ```env
   VITE_FIREBASE_API_KEY=AIzaSy...your_actual_key
   ```

3. **Check API key restrictions** (Google Cloud Console → APIs & Services → Credentials → your API key):
   - If "Application restrictions" is set, add `https://localhost:5173` and `http://localhost:5173` for local dev.
   - Or temporarily set to "None" to test.

---

## 3. Realtime Database

1. Go to **Build → Realtime Database**
2. Choose your region (e.g. **asia-southeast1** – already set)
3. Your database URL: `https://blazly-social-51a89-default-rtdb.asia-southeast1.firebasedatabase.app`

### Rules (Realtime Database)

In **Realtime Database → Rules**:

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read": "$uid === auth.uid",
        ".write": "$uid === auth.uid"
      }
    },
    "images": {
      ".read": true,
      ".write": "auth != null"
    }
  }
}
```

Adjust according to your security model. Images are stored on your backend server, not in Realtime Database.

---

## 4. Firestore Database

1. Go to **Build → Firestore Database**
2. Click **Create database**
3. Choose **Start in test mode** (or **production** and set rules)
4. Choose the same region as Realtime DB (e.g. asia-southeast1)

### Firestore Rules

In **Firestore → Rules**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /posts/{postId} {
      allow read, write: if request.auth != null;
    }
    match /integrations/{integrationId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### Suggested Collections (for future migration from MongoDB)

- **users** – `{ uid, email, name, profile, createdAt }`
- **posts** – `{ userId, content, platforms, imageUrl, status, scheduledAt, publishedAt, createdAt }`
- **integrations** – `{ userId, platform, accessToken, platformUserId, isActive, createdAt }`

---

## 5. Frontend Web App Config

1. Go to **Project Settings → Your apps**
2. Select your web app (or create one)
3. Your config is already in `frontend/src/firebase.js`:
   - apiKey
   - authDomain
   - databaseURL (Realtime DB)
   - projectId
   - storageBucket
   - messagingSenderId
   - appId

---

## 6. Realtime Database vs Firestore

| Use Case     | Service              | Purpose                     |
|--------------|----------------------|-----------------------------|
| User auth    | Firebase Auth        | Google, Email, etc.         |
| User profile | Firestore / Realtime | Structured user data        |
| Posts        | Firestore            | Posts, scheduling, metadata|
| Integrations | Firestore            | OAuth tokens, platform config |
| AI images    | **Firebase Storage** | `uploads/` path, public URLs |
| Post images  | **Firebase Storage** | User uploads, public URLs    |

Realtime Database: good for real-time syncing and simple JSON.  
Firestore: better for complex queries, indexing, and scaling.  
Firebase Storage: images (uploads + AI-generated) – public URLs, no `API_PUBLIC_URL` needed.

---

## 7. Image Storage (Firebase Storage)

1. **User uploads** (PostComposer) and **AI-generated images** (Gemini) are stored in Firebase Storage at `uploads/`.
2. Each file gets a public URL: `https://storage.googleapis.com/{bucket}/uploads/{filename}`.
3. Instagram/LinkedIn fetch directly from these URLs – no `API_PUBLIC_URL` or ngrok needed.
4. Ensure `storage.rules` allows public read for `uploads/` (see project root).

---

## 8. Checklist

- [ ] Google Auth enabled in Firebase Console
- [ ] Realtime Database created + rules set (optional)
- [ ] Firestore created + rules set (optional)
- [ ] `API_PUBLIC_URL` set in backend `.env` for Instagram image posting
- [ ] Authorized domains include localhost (and production domain)
