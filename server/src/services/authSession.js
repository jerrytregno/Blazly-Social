/**
 * Centralized session handling for authentication.
 * Ensures consistent session creation and cleanup across email, Google, and OAuth flows.
 */
import { signToken } from './jwt.js';

const COOKIE_NAME = 'blazly.sid';

/**
 * Create session for authenticated user.
 * Sets session.userId, optionally session.uid (Firebase), clears OAuth temp data.
 * @param {object} req - Express request
 * @param {object} user - User object (from Firestore)
 * @param {string} [firebaseUid] - Optional Firebase UID for Google users
 * @returns {string} JWT token for frontend
 */
export function createSession(req, user, firebaseUid = null) {
  req.session.userId = String(user._id);
  if (firebaseUid) {
    req.session.uid = firebaseUid;
  }
  // Clear any OAuth temp state
  const oauthKeys = [
    'oauthState', 'facebookOAuthState', 'twitterOAuthState', 'twitterCodeVerifier',
    'facebookAccessToken', 'facebookId', 'facebookProfile', 'facebookPages',
    'facebookTokenExpiresAt', 'facebookUserId', 'linkedinOAuthState', 'linkedinUserId',
    'twitterOAuth1RequestSecret', 'twitterOAuth1UserId', 'threadsOAuthState', 'threadsUserId',
  ];
  oauthKeys.forEach((k) => delete req.session[k]);
  return signToken(user._id);
}

/**
 * Destroy session and clear auth cookie.
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {function} callback - (err) => void
 */
export function destroySession(req, res, callback) {
  const cookieOpts = {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  };
  if (process.env.NODE_ENV === 'development') {
    cookieOpts.domain = 'localhost';
  }
  req.session.destroy((err) => {
    res.clearCookie(COOKIE_NAME, cookieOpts);
    callback(err);
  });
}

/**
 * Save session and send JSON response.
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {object} payload - { token, user?, ok?, isNew? }
 * @param {number} [status=200]
 */
export function saveSessionAndRespond(req, res, payload, status = 200) {
  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err);
      return res.status(500).json({ error: 'Session error' });
    }
    res.status(status).json(payload);
  });
}
