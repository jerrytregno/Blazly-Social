import { getDb, docToObject, serializeForFirestore } from './firestore.js';

const COL = 'userProfiles';

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
