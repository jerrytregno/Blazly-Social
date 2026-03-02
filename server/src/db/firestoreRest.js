/**
 * Firestore REST API client - uses Firebase ID token (no service account).
 * For use when FIREBASE_SERVICE_ACCOUNT is not set (e.g. Vercel without credentials).
 */
import { config } from '../config.js';

const PROJECT_ID = config.firebaseProjectId || 'blazly-social-51a89';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: 'NULL_VALUE' };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') return { integerValue: String(val) };
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toFirestoreValue) } };
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { nullValue: 'NULL_VALUE' };
}

function fromFirestoreValue(field) {
  if (!field) return null;
  if (field.nullValue !== undefined) return null;
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.integerValue !== undefined) return parseInt(field.integerValue, 10);
  if (field.doubleValue !== undefined) return field.doubleValue;
  if (field.timestampValue !== undefined) return new Date(field.timestampValue);
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.arrayValue?.values) return field.arrayValue.values.map(fromFirestoreValue);
  if (field.mapValue?.fields) {
    const obj = {};
    for (const [k, v] of Object.entries(field.mapValue.fields)) {
      obj[k] = fromFirestoreValue(v);
    }
    return obj;
  }
  return null;
}

function docToObject(doc) {
  if (!doc?.name || !doc.fields) return null;
  const id = doc.name.split('/').pop();
  const data = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    data[k] = fromFirestoreValue(v);
  }
  return { _id: id, id, ...data };
}

/**
 * Get a document by path. Path is like "users/abc123" or "integrations/uid_linkedin"
 */
export async function getDocument(token, collection, docId) {
  const url = `${BASE}/${collection}/${docId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Firestore get failed: ${res.status}`);
  }
  const doc = await res.json();
  return docToObject(doc);
}

/**
 * List documents in a collection with optional query.
 * For simple where('field','==','value') only.
 */
export async function listDocuments(token, collection, field, op, value) {
  const url = `${BASE}/${collection}`;
  let finalUrl = url;
  if (field && op && value !== undefined) {
    finalUrl += `?mask.fieldPaths=${field}`;
  }
  const res = await fetch(finalUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Firestore list failed: ${res.status}`);
  const data = await res.json();
  const docs = (data.documents || []).map(docToObject);
  if (field && op === '==' && value !== undefined) {
    return docs.filter((d) => d[field] === value || d[field] === String(value));
  }
  return docs;
}

/**
 * Run a structured query. Simplified for common cases.
 */
export async function runQuery(token, collection, whereClauses = [], orderBy = null, limit = 100) {
  const query = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      limit,
    },
  };
  if (whereClauses.length > 0) {
    query.structuredQuery.where = {
      compositeFilter: {
        op: 'AND',
        filters: whereClauses.map(({ field, op, value }) => ({
          fieldFilter: {
            field: { fieldPath: field },
            op: op === '==' ? 'EQUAL' : op,
            value: toFirestoreValue(value),
          },
        })),
      },
    };
  }
  if (orderBy) {
    query.structuredQuery.orderBy = [{ field: { fieldPath: orderBy.field }, direction: orderBy.direction || 'DESCENDING' }];
  }

  const url = `${BASE}:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(query),
  });
  if (!res.ok) throw new Error(`Firestore query failed: ${res.status}`);
  const results = await res.json();
  const docs = [];
  for (const r of results) {
    if (r.document) docs.push(docToObject(r.document));
  }
  return docs;
}

/**
 * Create or overwrite a document.
 */
export async function setDocument(token, collection, docId, data) {
  const fields = {};
  const toWrite = { ...data };
  delete toWrite._id;
  delete toWrite.id;
  for (const [k, v] of Object.entries(toWrite)) {
    if (v !== undefined) fields[k] = toFirestoreValue(v);
  }
  const url = `${BASE}/${collection}/${docId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Firestore set failed: ${res.status}`);
  const doc = await res.json();
  return docToObject(doc);
}

/**
 * Create a document with auto-generated ID.
 */
export async function addDocument(token, collection, data) {
  const fields = {};
  const toWrite = { ...data };
  delete toWrite._id;
  delete toWrite.id;
  for (const [k, v] of Object.entries(toWrite)) {
    if (v !== undefined) fields[k] = toFirestoreValue(v);
  }
  const url = `${BASE}/${collection}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Firestore add failed: ${res.status}`);
  const doc = await res.json();
  const id = doc.name?.split('/').pop();
  return { _id: id, id, ...data };
}

/**
 * Update document fields (merge).
 */
export async function updateDocument(token, collection, docId, data) {
  const fields = {};
  const toWrite = { ...data };
  delete toWrite._id;
  delete toWrite.id;
  for (const [k, v] of Object.entries(toWrite)) {
    if (v !== undefined) fields[k] = toFirestoreValue(v);
  }
  const url = `${BASE}/${collection}/${docId}?updateMask.fieldPaths=${Object.keys(fields).join('&updateMask.fieldPaths=')}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Firestore update failed: ${res.status}`);
  const doc = await res.json();
  return docToObject(doc);
}

export { docToObject, toFirestoreValue, fromFirestoreValue };
