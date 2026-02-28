import { getDb, docToObject, serializeForFirestore } from './firestore.js';

const COL = 'posts';

export async function find(query, opts = {}) {
  const db = getDb();
  let q = db.collection(COL);
  if (query.userId) q = q.where('userId', '==', String(query.userId));
  if (query.status) q = q.where('status', '==', query.status);
  if (query.platforms) {
    if (typeof query.platforms === 'object' && query.platforms.$in) {
      const arr = query.platforms.$in;
      if (arr.length === 1) q = q.where('platforms', 'array-contains', arr[0]);
      else if (arr.length <= 10) q = q.where('platforms', 'array-contains-any', arr);
    }
  }
  if (query.scheduledAt?.$lte) {
    q = q.where('scheduledAt', '<=', query.scheduledAt.$lte);
  }
  if (query.createdAt) {
    if (query.createdAt.$gte) q = q.where('createdAt', '>=', query.createdAt.$gte);
    if (query.createdAt.$lte) q = q.where('createdAt', '<=', query.createdAt.$lte);
  }
  if (query.publishedAt) {
    if (query.publishedAt.$gte) q = q.where('publishedAt', '>=', query.publishedAt.$gte);
    if (query.publishedAt.$lte) q = q.where('publishedAt', '<=', query.publishedAt.$lte);
  }
  if (query._id?.$lt) {
    const startDoc = await db.collection(COL).doc(String(query._id.$lt)).get();
    if (startDoc.exists) q = q.startAfter(startDoc);
  }
  // For scheduled posts, order by scheduledAt asc; else by createdAt desc
  if (query.status === 'scheduled' && query.scheduledAt?.$lte) {
    q = q.orderBy('scheduledAt', 'asc');
  } else {
    q = q.orderBy('createdAt', 'desc');
  }
  const limit = opts.limit ?? 10;
  q = q.limit(limit);
  const snap = await q.get();
  return snap.docs.map((d) => docToObject(d));
}

export async function findOne(query) {
  const db = getDb();
  if (query._id || query.id) {
    const doc = await db.collection(COL).doc(String(query._id || query.id)).get();
    if (!doc.exists) return null;
    const obj = docToObject(doc);
    if (query.userId && obj.userId !== String(query.userId)) return null;
    return obj;
  }
  let q = db.collection(COL);
  if (query.userId) q = q.where('userId', '==', String(query.userId));
  if (query.content) q = q.where('content', '==', query.content);
  if (query.imageUrl !== undefined) q = q.where('imageUrl', '==', query.imageUrl);
  if (query.status) q = q.where('status', '==', query.status);
  const snap = await q.limit(1).get();
  if (snap.empty) return null;
  return docToObject(snap.docs[0]);
}

export async function create(data) {
  const db = getDb();
  const copy = { ...data, userId: String(data.userId), createdAt: new Date(), updatedAt: new Date() };
  const ref = await db.collection(COL).add(serializeForFirestore(copy));
  const doc = await ref.get();
  return docToObject(doc);
}

export async function countDocuments(query) {
  const db = getDb();
  let q = db.collection(COL);
  if (query.userId) q = q.where('userId', '==', String(query.userId));
  if (query.status) q = q.where('status', '==', query.status);
  const snap = await q.count().get();
  return snap.data().count;
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

export async function findOneAndDelete(query) {
  const db = getDb();
  const doc = await findOne(query);
  if (!doc) return null;
  await db.collection(COL).doc(doc._id).delete();
  return doc;
}
