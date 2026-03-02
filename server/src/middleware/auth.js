import { config } from '../config.js';
import { verifyFirebaseIdToken } from '../services/firebaseTokenVerify.js';

/**
 * Auth middleware - Firebase ID token only (no Firestore/server user lookup).
 * req.user = { uid, email, name, _id: uid } from token.
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    let decoded = await verifyFirebaseIdToken(token);
    if (!decoded && config.nodeEnv === 'development') {
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          decoded = {
            uid: payload.user_id || payload.sub || payload.uid,
            email: payload.email,
            name: payload.name,
            picture: payload.picture,
          };
        }
      } catch (_) {}
    }
    if (decoded?.uid) {
      req.user = {
        _id: decoded.uid,
        id: decoded.uid,
        uid: decoded.uid,
        email: decoded.email,
        name: decoded.name,
        profile: {
          profilePicture: decoded.picture,
          name: decoded.name,
        },
      };
      return next();
    }
  } catch (err) {
    console.error('Auth verification failed:', err.message);
  }
  res.status(401).json({ error: 'Not authenticated' });
}
