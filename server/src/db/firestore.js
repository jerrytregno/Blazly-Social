/**
 * Firestore database layer - no firebase-admin.
 * Uses @google-cloud/firestore with Application Default Credentials.
 * All collections: users, userProfiles, posts, integrations, competitors,
 * keywordPolls, keywordMatches, rateLimits, ideaCaches, generatedImages,
 * knowledgeBases, trendInsights, sessions
 */
import { getFirestore } from '../firebase.js';
import { Timestamp } from '@google-cloud/firestore';

function getDb() {
  const db = getFirestore();
  if (!db) throw new Error('Firestore not initialized. Run: gcloud auth application-default login');
  return db;
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
        obj[k] = Timestamp.fromDate(v);
      } else if (v instanceof Map) {
        obj[k] = Object.fromEntries(v);
        walk(obj[k]);
      } else if (v && typeof v === 'object' && !Array.isArray(v) && !(v && typeof v.toDate === 'function')) {
        walk(v);
      }
    });
  };
  walk(copy);
  return copy;
}

export { getDb };

export async function connectDb() {
  const db = getDb();
  db.settings({ ignoreUndefinedProperties: true });
  console.log('Firestore connected');
}
