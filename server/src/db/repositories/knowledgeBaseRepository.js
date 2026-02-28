import { getDb, docToObject } from '../firestore.js';

const COL = 'knowledgeBase';

export async function findOne(query) {
  const db = getDb();
  let q = db.collection(COL).where('userId', '==', String(query.userId)).where('type', '==', query.type);
  if (query.sourceUrl) q = q.where('sourceUrl', '==', query.sourceUrl);
  const snap = await q.limit(1).get();
  if (snap.empty) return null;
  return docToObject(snap.docs[0]);
}

export async function find(query) {
  const db = getDb();
  const snap = await db.collection(COL)
    .where('userId', '==', String(query.userId))
    .where('type', '==', query.type)
    .get();
  return snap.docs.map(d => docToObject(d));
}

export async function findOneAndUpdate(query, update, opts = {}) {
  const db = getDb();
  const { upsert = false, new: returnNew = true } = opts;
  const userId = String(query.userId);
  const type = query.type;
  const sourceUrl = query.sourceUrl || '';

  let q = db.collection(COL).where('userId', '==', userId).where('type', '==', type);
  if (sourceUrl) q = q.where('sourceUrl', '==', sourceUrl);
  const snap = await q.limit(1).get();

  const data = { ...update, updatedAt: new Date() };
  delete data._id;
  delete data.id;

  if (!snap.empty) {
    const ref = snap.docs[0].ref;
    await ref.update(data);
    if (returnNew) {
      const updated = await ref.get();
      return docToObject(updated);
    }
    return null;
  }

  if (upsert) {
    const ref = await db.collection(COL).add({
      userId,
      type,
      sourceUrl,
      ...data,
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
