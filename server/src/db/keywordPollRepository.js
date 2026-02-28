import { getDb, docToObject, serializeForFirestore } from './firestore.js';

const COL = 'keywordPolls';

export async function findOne(query) {
  const db = getDb();
  const snap = await db.collection(COL).where('userId', '==', String(query.userId)).limit(1).get();
  if (snap.empty) return null;
  return docToObject(snap.docs[0]);
}

export async function findOneAndUpdate(query, update, opts = {}) {
  const db = getDb();
  const { upsert = false, new: returnNew = true } = opts;
  const userId = String(query.userId);
  const snap = await db.collection(COL).where('userId', '==', userId).limit(1).get();
  const data = { ...update, userId, updatedAt: new Date() };
  delete data._id;
  delete data.id;

  if (!snap.empty) {
    const ref = snap.docs[0].ref;
    await ref.update(serializeForFirestore(data));
    if (returnNew) {
      const updated = await ref.get();
      return docToObject(updated);
    }
    return null;
  }

  if (upsert) {
    const ref = await db.collection(COL).add({
      ...serializeForFirestore(data),
      createdAt: new Date(),
    });
    if (returnNew) {
      const created = await ref.get();
      return docToObject(created);
    }
    return null;
  }
  return null;
}

export async function find(query, opts = {}) {
  const db = getDb();
  let q = db.collection(COL);
  if (query.enabled !== undefined) q = q.where('enabled', '==', query.enabled);
  const snap = await q.get();
  let docs = snap.docs.map((d) => docToObject(d));
  if (opts.select && docs.length) {
    const fields = opts.select.replace(/-/g, ' ').split(' ').filter(Boolean);
    if (fields.includes('userId') || opts.select === 'userId') {
      docs = docs.map((d) => ({ userId: d.userId }));
    }
  }
  return docs;
}

export async function findByIdAndUpdate(id, update) {
  const db = getDb();
  const ref = db.collection(COL).doc(String(id));
  const existing = await ref.get();
  if (!existing.exists) return null;
  const data = { ...update, updatedAt: new Date() };
  delete data._id;
  delete data.id;
  await ref.update(serializeForFirestore(data));
  const updated = await ref.get();
  return docToObject(updated);
}
