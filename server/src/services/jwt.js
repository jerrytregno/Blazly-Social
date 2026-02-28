import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function signToken(userId) {
  return jwt.sign(
    { userId: userId.toString() },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

export function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    return decoded?.userId || null;
  } catch (_) {
    return null;
  }
}
