/**
 * Verify Firebase ID tokens without firebase-admin.
 * Uses JWT verification with Google's public keys - no service account needed.
 * Works with gcloud auth application-default login or in serverless (no credentials for token verify).
 */
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const PROJECT_ID = config.firebaseProjectId || 'blazly-social-51a89';
const JWKS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let _cachedKeys = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function getPublicKeys() {
  if (_cachedKeys && Date.now() < _cacheExpiry) return _cachedKeys;
  const res = await fetch(JWKS_URL);
  const keys = await res.json();
  _cachedKeys = keys;
  _cacheExpiry = Date.now() + CACHE_TTL_MS;
  return keys;
}

function getKeyForKid(keys, kid) {
  const pem = keys[kid];
  if (!pem) return null;
  return pem;
}

/**
 * Verify Firebase ID token. Returns decoded payload or null.
 * @param {string} idToken - Firebase ID token from client
 * @returns {Promise<{ uid: string, email?: string, name?: string, picture?: string } | null>}
 */
export async function verifyFirebaseIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') return null;
  try {
    const decoded = jwt.decode(idToken, { complete: true });
    if (!decoded?.header?.kid || !decoded?.payload) return null;

    const keys = await getPublicKeys();
    const pem = getKeyForKid(keys, decoded.header.kid);
    if (!pem) return null;

    const payload = jwt.verify(idToken, pem, {
      algorithms: ['RS256'],
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    });

    return {
      uid: payload.user_id || payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };
  } catch (err) {
    if (config.nodeEnv === 'development') {
      console.warn('[firebaseTokenVerify]', err.message);
    }
    return null;
  }
}
