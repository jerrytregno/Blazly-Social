import { auth } from '../firebase.js';
import { config } from '../config.js';
import * as userRepo from '../db/userRepository.js';
import { verifyToken } from '../services/jwt.js';

export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  let firebaseUid = null;
  let mongoUserId = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1];
    const jwtUserId = verifyToken(token);
    if (jwtUserId) mongoUserId = jwtUserId;
  }

  if (!mongoUserId && req.session?.userId) {
    mongoUserId = req.session.userId;
  }

  let firebaseDecodedToken = null;
  if (!mongoUserId && !firebaseUid && authHeader?.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1];
    try {
      if (!auth) {
        if (config.nodeEnv === 'development') {
          try {
            const parts = token.split('.');
            if (parts.length !== 3) throw new Error('Invalid JWT');
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            firebaseUid = payload.user_id || payload.sub || payload.uid;
            firebaseDecodedToken = { uid: firebaseUid, email: payload.email, name: payload.name, picture: payload.picture };
            if (!firebaseUid) throw new Error('Token payload missing UID');
          } catch (_) {}
        }
      } else {
        firebaseDecodedToken = await auth.verifyIdToken(token);
        firebaseUid = firebaseDecodedToken.uid;
      }
    } catch (err) {
      console.error('Auth verification failed:', err.message);
    }
  }

  if (!mongoUserId && !firebaseUid && req.session?.uid) {
    firebaseUid = req.session.uid;
  }

  try {
    if (mongoUserId) {
      const user = await userRepo.findById(mongoUserId);
      if (user) {
        req.user = user;
        return next();
      }
    }

    if (firebaseUid) {
      let user = await userRepo.findOne({ firebaseUid });
      if (!user && firebaseDecodedToken?.email) {
        user = await userRepo.findOne({ email: firebaseDecodedToken.email });
      }
      if (!user) {
        return res.status(403).json({
          error: 'Account not found. Please sign up with email first, then you can sign in with Google.',
        });
      }
      if (!user.firebaseUid) {
        await userRepo.findByIdAndUpdate(user._id, {
          firebaseUid,
          ...(firebaseDecodedToken?.email && !user.email ? { email: firebaseDecodedToken.email } : {}),
          ...(firebaseDecodedToken?.name && !user.name ? { name: firebaseDecodedToken.name } : {}),
        }, { new: true });
        user = await userRepo.findById(user._id);
      }
      req.user = user;
      req.user.uid = firebaseUid;
      if (req.session && !req.session.userId) {
        req.session.userId = user._id;
        req.session.uid = firebaseUid;
      }
      return next();
    }
  } catch (err) {
    console.error('User lookup failed:', err);
    return res.status(500).json({ error: 'Authentication internal error' });
  }

  res.status(401).json({ error: 'Not authenticated' });
}
