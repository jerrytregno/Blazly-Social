import { getDb, docToObject } from '../firestore.js';

const COL = 'integrations';

function docId(userId, platform) {
  return `${String(userId)}_${platform}`;
}

export async function find(query) {
  const db = getDb();
  let q = db.collection(COL);
  if (query.userId) q = q.where('userId', '==', String(query.userId));
  if (query.platform) q = q.where('platform', '==', query.platform);
  if (query.isActive !== undefined) q = q.where('isActive', '==', query.isActive);
  const snap = await q.get();
  return snap.docs.map(d => docToObject(d));
}

export async function findOne(query) {
  const db = getDb();
  if (query.userId && query.platform) {
    const ref = db.collection(COL).doc(docId(query.userId, query.platform));
    const doc = await ref.get();
    return docToObject(doc);
  }
  let q = db.collection(COL);
  if (query.userId) q = q.where('userId', '==', String(query.userId));
  if (query.platform) q = q.where('platform', '==', query.platform);
  const snap = await q.limit(1).get();
  if (snap.empty) return null;
  return docToObject(snap.docs[0]);
}

export async function findOneAndUpdate(query, update, opts = {}) {
  const db = getDb();
  const { upsert = false, new: returnNew = true } = opts;
  const userId = query.userId?.toString?.() ?? String(query.userId);
  const platform = query.platform;
  if (!userId || !platform) throw new Error('findOneAndUpdate Integration: need userId and platform');

  const ref = db.collection(COL).doc(docId(userId, platform));
  const existing = await ref.get();

  const data = { ...update, userId, platform, updatedAt: new Date() };
  delete data._id;
  delete data.id;

  if (existing.exists) {
    await ref.update(data);
    if (returnNew) {
      const updated = await ref.get();
      return docToObject(updated);
    }
    return null;
  }

  if (upsert) {
    await ref.set({ ...data, createdAt: new Date() });
    if (returnNew) {
      const created = await ref.get();
      return docToObject(created);
    }
    return null;
  }
  return null;
}

export async function updateLastUsed(docId, lastUsedAt) {
  const db = getDb();
  await db.collection(COL).doc(docId).update({ lastUsedAt: lastUsedAt || new Date(), updatedAt: new Date() });
}
