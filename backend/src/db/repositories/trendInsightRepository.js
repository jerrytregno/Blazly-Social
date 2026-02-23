import { getDb, docToObject } from '../firestore.js';

const COL = 'trendInsights';

export async function create(data) {
  const db = getDb();
  const copy = { ...data, userId: String(data.userId), createdAt: new Date(), updatedAt: new Date() };
  const ref = await db.collection(COL).add(copy);
  const doc = await ref.get();
  return docToObject(doc);
}

export async function find(query, opts = {}) {
  const db = getDb();
  let q = db.collection(COL).where('userId', '==', String(query.userId));
  if (opts.sort) {
    const [[k, v]] = Object.entries(opts.sort);
    q = q.orderBy(k, v === -1 ? 'desc' : 'asc');
  }
  const limit = opts.limit || 50;
  q = q.limit(limit);
  const snap = await q.get();
  return snap.docs.map(d => docToObject(d));
}

export async function findOneAndUpdate(query, update, opts = {}) {
  const db = getDb();
  const docId = query._id;
  if (!docId) return null;
  const ref = db.collection(COL).doc(String(docId));
  const existing = await ref.get();
  if (!existing.exists) return null;
  const data = { ...update, updatedAt: new Date() };
  delete data._id;
  delete data.id;
  await ref.update(data);
  if (opts.new) {
    const updated = await ref.get();
    return docToObject(updated);
  }
  return null;
}
