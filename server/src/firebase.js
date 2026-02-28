import admin from 'firebase-admin';
import fs from 'fs';
import { config } from './config.js';

// Initialize Firebase Admin
if (!admin.apps.length) {
    try {
        let credential;
        let serviceAccount;

        if (config.firebaseServiceAccount || config.firebaseServiceAccountPath) {
            try {
                if (config.firebaseServiceAccountPath) {
                    const json = fs.readFileSync(config.firebaseServiceAccountPath, 'utf8');
                    serviceAccount = JSON.parse(json);
                } else {
                    serviceAccount = typeof config.firebaseServiceAccount === 'string'
                        ? JSON.parse(config.firebaseServiceAccount)
                        : config.firebaseServiceAccount;
                }
                if (!serviceAccount) serviceAccount = null;
                credential = admin.credential.cert(serviceAccount);
            } catch (err) {
                console.error('Failed to load Firebase service account:', err.message);
            }
        }

        // Only initialize if we have a credential or we're in an environment that might have default ones
        // In local dev without config.firebaseServiceAccount, we avoid calling applicationDefault() to prevent crash
        if (credential || config.nodeEnv === 'production') {
            const projectId = (typeof serviceAccount === 'object' && serviceAccount?.project_id) || 'blazly-social-51a89';
            const storageBucket = `${projectId}.firebasestorage.app`;
            admin.initializeApp({
                credential: credential || admin.credential.applicationDefault(),
                projectId,
                storageBucket,
            });
            console.log('Firebase Admin initialized');
        } else {
            console.warn('Firebase Admin NOT initialized: No credentials provided.');
        }
    } catch (err) {
        console.error('Firebase Admin init failed:', err.message);
    }
}

export const auth = admin.apps.length ? admin.auth() : null;
export const storage = admin.apps.length ? admin.storage() : null;
export default admin;
