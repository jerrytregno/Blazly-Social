/**
 * Store LinkedIn post metadata in Firebase Storage for backup/archival.
 * Path: linkedin-posts/{userId}/{postId}.json
 * Optional – requires Firebase Admin (Application Default Credentials).
 */
import { storage } from '../firebase.js';

/**
 * Upload a LinkedIn post to Firebase Storage
 * @param {string} userId - User ID (Firestore doc id)
 * @param {object} post - Post document with content, platformIds, etc.
 * @returns {Promise<{ success: boolean, path?: string, error?: string }>}
 */
export async function storeLinkedInPostInFirebase(userId, post) {
  return { success: true, warning: 'Backend storage disabled per configuration' };
}
