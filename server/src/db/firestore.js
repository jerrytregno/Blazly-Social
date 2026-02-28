/**
 * Firestore database layer - replaces MongoDB.
 * All collections: users, userProfiles, posts, integrations, competitors,
 * keywordPolls, keywordMatches, rateLimits, ideaCaches, generatedImages,
 * knowledgeBases, trendInsights, sessions
 */
import admin from 'firebase-admin';

let _db = null;

export function getDb() {
  if (!admin.apps.length) {
    throw new Error('Firebase Admin not initialized. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH in .env');
  }
  if (!_db) {
    _db = admin.firestore();
  }
  return _db;
}

/**
 * Convert Firestore document to plain object with _id.
 * Handles Timestamp -> Date conversion (including nested objects).
 */
export function docToObject(doc) {
  if (!doc || !doc.exists) return null;
  const data = doc.data();
  const id = doc.id;
  const result = { _id: id, id, ...data };
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    Object.keys(obj).forEach((k) => {
      const v = obj[k];
      if (v && typeof v.toDate === 'function') {
        obj[k] = v.toDate();
      } else if (Array.isArray(v)) {
        v.forEach((item) => item && typeof item === 'object' && walk(item));
      } else if (v && typeof v === 'object' && !(v instanceof Date)) {
        walk(v);
      }
    });
  };
  walk(result);
  return result;
}

/**
 * Serialize data for Firestore (Date -> Timestamp, Map -> object, remove _id).
 */
export function serializeForFirestore(data) {
  const copy = { ...data };
  delete copy._id;
  delete copy.id;
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    Object.keys(obj).forEach((k) => {
      const v = obj[k];
      if (v instanceof Date) {
        obj[k] = admin.firestore.Timestamp.fromDate(v);
      } else if (v instanceof Map) {
        obj[k] = Object.fromEntries(v);
        walk(obj[k]);
      } else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof admin.firestore.Timestamp)) {
        walk(v);
      }
    });
  };
  walk(copy);
  return copy;
}

export async function connectDb() {
  if (!admin.apps.length) {
    throw new Error('Firebase Admin not initialized. Ensure FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH is set.');
  }
  _db = admin.firestore();
  _db.settings({ ignoreUndefinedProperties: true });
  console.log('Firestore connected');
}
