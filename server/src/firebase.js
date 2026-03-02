/**
 * Firebase/Firestore setup – no firebase-admin, no service account file.
 * - Firestore: @google-cloud/firestore (uses Application Default Credentials)
 * - Auth: JWT verification via firebaseTokenVerify.js (no SDK)
 * - Storage: Client uploads directly; no backend storage
 *
 * Run once: gcloud auth application-default login
 * Project: blazly-social-51a89
 */
import { Firestore } from '@google-cloud/firestore';
import { config } from './config.js';

let _firestore = null;

export function getFirestore() {
  if (!_firestore) {
    const projectId = config.firebaseProjectId || 'blazly-social-51a89';
    _firestore = new Firestore({ projectId });
    console.log('Firestore initialized (no service account file)');
  }
  return _firestore;
}

// Legacy exports for compatibility
export const auth = null; // Use verifyFirebaseIdToken from firebaseTokenVerify.js
export const storage = null;
export default { getFirestore, auth, storage };
