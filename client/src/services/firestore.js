/**
 * Client-side Firestore services - no server Firestore needed.
 * Uses Firebase client SDK with user's auth token.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  query,
  where,
  limit,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

// Helper: convert Firestore Timestamp to Date in object
function mapTimestamps(obj) {
  if (!obj) return obj;
  const out = { ...obj };
  for (const [k, v] of Object.entries(out)) {
    if (v && typeof v.toDate === 'function') out[k] = v.toDate();
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = mapTimestamps(v);
  }
  return out;
}

/** Users collection - doc ID = Firebase UID */
export async function getUser(uid) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { _id: snap.id, id: snap.id, ...mapTimestamps(snap.data()) };
}

export async function setUser(uid, data) {
  const ref = doc(db, 'users', uid);
  await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  return getUser(uid);
}

export async function createUser(uid, data) {
  const ref = doc(db, 'users', uid);
  await setDoc(ref, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { _id: uid, id: uid, ...data };
}

/** Integrations - doc ID = {uid}_{platform} */
function integrationDocId(uid, platform) {
  return `${uid}_${platform}`;
}

export async function getIntegrations(uid) {
  const q = query(
    collection(db, 'integrations'),
    where('userId', '==', uid),
    where('isActive', '==', true)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ _id: d.id, id: d.id, ...mapTimestamps(d.data()) }));
}

export async function setIntegration(uid, platform, data) {
  const id = integrationDocId(uid, platform);
  const ref = doc(db, 'integrations', id);
  await setDoc(ref, {
    userId: uid,
    platform,
    ...data,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  const snap = await getDoc(ref);
  return { _id: snap.id, id: snap.id, ...mapTimestamps(snap.data()) };
}

/** Posts */
export async function getPosts(uid, opts = {}) {
  const { limit: lim = 50, platform, status } = opts;
  const postsRef = collection(db, 'posts');
  // Avoid composite index requirement (userId+createdAt) by fetching up to 200 docs
  // and sorting in memory — works for typical user post volumes.
  const q = query(postsRef, where('userId', '==', uid), limit(200));
  const snap = await getDocs(q);
  let docs = snap.docs.map((d) => ({ _id: d.id, id: d.id, ...mapTimestamps(d.data()) }));
  // Filter first, then sort, then slice
  if (platform) docs = docs.filter((p) => Array.isArray(p.platforms) && p.platforms.includes(platform));
  if (status) docs = docs.filter((p) => p.status === status);
  docs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return docs.slice(0, lim);
}

export async function createPost(uid, data) {
  const ref = collection(db, 'posts');
  const docRef = await addDoc(ref, {
    ...data,
    userId: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const snap = await getDoc(docRef);
  return { _id: snap.id, id: snap.id, ...mapTimestamps(snap.data()) };
}

export async function updatePost(uid, postId, data) {
  const ref = doc(db, 'posts', postId);
  const snap = await getDoc(ref);
  if (!snap.exists() || snap.data().userId !== uid) return null;
  await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
  const updated = await getDoc(ref);
  return { _id: updated.id, id: updated.id, ...mapTimestamps(updated.data()) };
}

export async function deletePost(uid, postId) {
  const ref = doc(db, 'posts', postId);
  const snap = await getDoc(ref);
  if (!snap.exists() || snap.data().userId !== uid) return false;
  await deleteDoc(ref);
  return true;
}

/** User profiles */
export async function getUserProfile(uid) {
  const q = query(
    collection(db, 'userProfiles'),
    where('userId', '==', uid),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { _id: d.id, id: d.id, ...mapTimestamps(d.data()) };
}

// ----- Competitors (client-side storage) -----

/** Recursively sanitize an object for Firestore:
 *  - Convert Date objects to ISO strings
 *  - Remove undefined values
 *  - Strip fields that are too large or not serializable (rawScrapedData, rawSnippet)
 */
function sanitizeForFirestore(obj, depth = 0) {
  if (obj === null || obj === undefined) return null;
  if (obj instanceof Date) return obj.toISOString();
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((v) => sanitizeForFirestore(v, depth + 1)).filter((v) => v !== undefined);
  const out = {};
  const STRIP_KEYS = new Set(['rawScrapedData', 'rawSnippet', 'rawSignals', 'structuredData']);
  for (const [k, v] of Object.entries(obj)) {
    if (STRIP_KEYS.has(k)) continue;
    if (v === undefined) continue;
    if (v && typeof v.toDate === 'function') { out[k] = v.toDate().toISOString(); continue; }
    if (typeof v === 'string' && v.length > 10000) { out[k] = v.slice(0, 10000); continue; }
    out[k] = depth < 8 ? sanitizeForFirestore(v, depth + 1) : String(v);
  }
  return out;
}

export async function getCompetitors(uid) {
  const q = query(collection(db, 'competitors'), where('userId', '==', uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, _id: d.id, ...mapTimestamps(d.data()) }));
}

/** Upsert a competitor by competitorUrl — update if exists, add if not */
export async function saveCompetitor(uid, data) {
  const clean = sanitizeForFirestore(data);
  delete clean._id; delete clean.id; delete clean.userId;

  // Check if already exists by URL
  if (clean.competitorUrl) {
    const q = query(
      collection(db, 'competitors'),
      where('userId', '==', uid),
      where('competitorUrl', '==', clean.competitorUrl),
      limit(1)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      const ref = snap.docs[0].ref;
      await updateDoc(ref, { ...clean, updatedAt: serverTimestamp() });
      const updated = await getDoc(ref);
      return { id: ref.id, _id: ref.id, ...mapTimestamps(updated.data()) };
    }
  }

  const ref = collection(db, 'competitors');
  const docRef = await addDoc(ref, {
    ...clean,
    userId: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const snap2 = await getDoc(docRef);
  return { id: docRef.id, _id: docRef.id, ...mapTimestamps(snap2.data()) };
}

// ----- User Profile -----

export async function setUserProfile(uid, data) {
  const q = query(
    collection(db, 'userProfiles'),
    where('userId', '==', uid),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) {
    const ref = collection(db, 'userProfiles');
    const docRef = await addDoc(ref, {
      userId: uid,
      ...data,
      updatedAt: serverTimestamp(),
    });
    const d = await getDoc(docRef);
    return { _id: d.id, id: d.id, ...mapTimestamps(d.data()) };
  }
  const ref = snap.docs[0].ref;
  await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
  const d = await getDoc(ref);
  return { _id: d.id, id: d.id, ...mapTimestamps(d.data()) };
}
