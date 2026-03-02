/**
 * Database connection - Firestore (replaces MongoDB).
 * Firestore is initialized via firebase.js (no firebase-admin).
 */
import './firebase.js';
import { connectDb } from './db/firestore.js';

export { connectDb };
