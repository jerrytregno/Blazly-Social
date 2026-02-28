import { getDb, docToObject, serializeForFirestore } from './firestore.js';

const COL = 'generatedImages';

export async function create(data) {
  const db = getDb();
  const copy = { ...data, userId: String(data.userId), createdAt: new Date(), updatedAt: new Date() };
  const ref = await db.collection(COL).add(serializeForFirestore(copy));
  const doc = await ref.get();
  return docToObject(doc);
}
