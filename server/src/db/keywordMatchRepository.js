import { getDb, docToObject, serializeForFirestore } from './firestore.js';

const COL = 'keywordMatches';

export async function find(query, opts = {}) {
  const db = getDb();
  let q = db.collection(COL).where('userId', '==', String(query.userId));
  if (query.platform) {
    if (query.platform.$in && Array.isArray(query.platform.$in)) {
      const arr = query.platform.$in.slice(0, 10);
      if (arr.length === 1) q = q.where('platform', '==', arr[0]);
      else if (arr.length > 1) q = q.where('platform', 'in', arr);
    } else {
      q = q.where('platform', '==', query.platform);
    }
  }
  if (query.read !== undefined) q = q.where('read', '==', query.read);
  if (opts.sort) {
    const [[k, v]] = Object.entries(opts.sort);
    q = q.orderBy(k, v === -1 ? 'desc' : 'asc');
  }
  const limit = opts.limit || 50;
  q = q.limit(limit);
  const snap = await q.get();
  return snap.docs.map((d) => docToObject(d));
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
  let q = db.collection(COL).where('userId', '==', String(query.userId));
  if (query.keyword) q = q.where('keyword', '==', query.keyword);
  if (query.platform) q = q.where('platform', '==', query.platform);
  if (query.postId) q = q.where('postId', '==', query.postId);
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

export async function findOneAndUpdate(query, update, opts = {}) {
  const db = getDb();
  const doc = await findOne(query);
  if (!doc) return null;
  const ref = db.collection(COL).doc(doc._id);
  const data = { ...update, updatedAt: new Date() };
  delete data._id;
  delete data.id;
  await ref.update(serializeForFirestore(data));
  if (opts.new) {
    const updated = await ref.get();
    return docToObject(updated);
  }
  return null;
}
