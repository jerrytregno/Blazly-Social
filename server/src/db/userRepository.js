import bcrypt from 'bcryptjs';
import { getDb, docToObject, serializeForFirestore } from './firestore.js';

const COL = 'users';

export async function findById(id) {
  const db = getDb();
  const doc = await db.collection(COL).doc(String(id)).get();
  return docToObject(doc);
}

export async function findOne(query) {
  const db = getDb();
  if (query._id || query.id) {
    return findById(query._id || query.id);
  }
  let q = db.collection(COL);
  if (query.email) q = q.where('email', '==', query.email);
  if (query.firebaseUid) q = q.where('firebaseUid', '==', query.firebaseUid);
  if (query.facebookId) q = q.where('facebookId', '==', query.facebookId);
  if (query.twitterId) q = q.where('twitterId', '==', query.twitterId);
  const snap = await q.limit(1).get();
  if (snap.empty) return null;
  return docToObject(snap.docs[0]);
}

export async function create(data) {
  const db = getDb();
  const copy = { ...data };
  if (copy.password) {
    const salt = await bcrypt.genSalt(10);
    copy.password = await bcrypt.hash(copy.password, salt);
  }
  copy.createdAt = new Date();
  copy.updatedAt = new Date();
  const ref = await db.collection(COL).add(serializeForFirestore(copy));
  const doc = await ref.get();
  const obj = docToObject(doc);
  if (obj.password) delete obj.password;
  return obj;
}

export async function findByIdAndUpdate(id, update, opts = {}) {
  const db = getDb();
  const ref = db.collection(COL).doc(String(id));
  const existing = await ref.get();
  if (!existing.exists) return null;
  const data = { ...update, updatedAt: new Date() };
  if (data.password) {
    const salt = await bcrypt.genSalt(10);
    data.password = await bcrypt.hash(data.password, salt);
  }
  delete data._id;
  delete data.id;
  await ref.update(serializeForFirestore(data));
  if (opts.new) {
    const updated = await ref.get();
    const obj = docToObject(updated);
    if (obj.password) delete obj.password;
    return obj;
  }
  return null;
}

export async function comparePassword(user, candidatePassword) {
  if (!user?.password) return false;
  return bcrypt.compare(candidatePassword, user.password);
}

export async function find(query, opts = {}) {
  const db = getDb();
  let q = db.collection(COL);
  if (opts.select) {
    // Firestore doesn't support select; we fetch all and trim in memory
  }
  const snap = await q.get();
  let docs = snap.docs.map((d) => docToObject(d));
  if (opts.select) {
    const fields = opts.select.replace(/-/g, ' ').split(' ').filter(Boolean);
    const exclude = opts.select.includes('-');
    docs = docs.map((d) => {
      const out = {};
      Object.keys(d).forEach((k) => {
        if (k === 'password') return;
        if (exclude && fields.includes(k)) return;
        if (!exclude && fields.length && !fields.includes(k)) return;
        out[k] = d[k];
      });
      return out;
    });
  }
  return docs;
}
