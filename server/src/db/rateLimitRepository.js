import { getDb, docToObject } from './firestore.js';

const COL = 'rateLimits';

function docId(date, key) {
  return `${date}_${key}`;
}

export async function findOne(query) {
  const db = getDb();
  const { date, key } = query;
  const ref = db.collection(COL).doc(docId(date, key));
  const doc = await ref.get();
  return docToObject(doc);
}

export async function findOneAndUpdate(query, update, opts = {}) {
  const db = getDb();
  const { upsert = false, new: returnNew = true } = opts;
  const { date, key } = query;
  const ref = db.collection(COL).doc(docId(date, key));
  const existing = await ref.get();
  const inc = update.$inc;
  const newCount = ((existing.exists ? existing.data().count : 0) || 0) + (inc?.count ?? 1);
  const data = { date, key, count: newCount, updatedAt: new Date() };
  if (existing.exists) {
    await ref.update(data);
  } else if (upsert) {
    await ref.set({ ...data, createdAt: new Date() });
  }
  if (returnNew) {
    const updated = await ref.get();
    return docToObject(updated);
  }
  return null;
}
