/**
 * Database connection - Firestore (replaces MongoDB).
 * Firebase Admin must be initialized (via firebase.js) before connectDb.
 */
import './firebase.js';
import { connectDb } from './db/firestore.js';

export { connectDb };
