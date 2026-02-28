import { getDb, docToObject } from '../firestore.js';

const COL = 'competitors';

export async function find(query, opts = {}) {
  const db = getDb();
  let q = db.collection(COL).where('userId', '==', String(query.userId));
  if (opts.sort) {
    const [[k, v]] = Object.entries(opts.sort);
    q = q.orderBy(k, v === -1 ? 'desc' : 'asc');
  }
  const snap = await q.get();
  return snap.docs.map(d => docToObject(d));
}

export async function findOne(query) {
  const db = getDb();
  if (query._id) {
    const doc = await db.collection(COL).doc(String(query._id)).get();
    if (!doc.exists) return null;
    const obj = docToObject(doc);
    if (query.userId && obj.userId !== String(query.userId)) return null;
    return obj;
  }
  return null;
}

export async function findOneAndUpdate(query, update, opts = {}) {
  const db = getDb();
  const { upsert = false, new: returnNew = true } = opts;
  const userId = String(query.userId);

  let ref = null;
  if (query._id) {
    ref = db.collection(COL).doc(String(query._id));
  } else {
    const snap = await db.collection(COL)
      .where('userId', '==', userId)
      .where('competitorUrl', '==', query.competitorUrl)
      .limit(1)
      .get();
    if (!snap.empty) ref = snap.docs[0].ref;
  }

  const data = { ...update, updatedAt: new Date() };
  delete data._id;
  delete data.id;

  if (ref) {
    const existing = await ref.get();
    if (existing.exists) {
      await ref.update(data);
      if (returnNew) {
        const updated = await ref.get();
        return docToObject(updated);
      }
      return null;
    }
  }

  if (upsert && query.competitorName && query.competitorUrl) {
    const newRef = await db.collection(COL).add({
      userId,
      competitorName: query.competitorName,
      competitorUrl: query.competitorUrl,
      ...data,
      createdAt: new Date(),
    });
    if (returnNew) {
      const created = await newRef.get();
      return docToObject(created);
    }
    return null;
  }
  return null;
}
