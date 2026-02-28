/**
 * Firebase Storage service for image/file uploads.
 * Replaces local uploads/ folder - all images stored in Firebase Storage.
 */
import { storage } from '../firebase.js';

const BUCKET_PATH = 'uploads';

/**
 * Upload a buffer to Firebase Storage and return the public URL.
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Filename (e.g. post-abc123.jpg)
 * @param {string} [mimeType] - MIME type (default: image/png)
 * @returns {Promise<{ url: string } | { error: string }>}
 */
export async function uploadBuffer(buffer, filename, mimeType = 'image/png') {
  if (!storage) {
    return { error: 'Firebase Storage not initialized. Set FIREBASE_SERVICE_ACCOUNT_PATH in .env.' };
  }
  try {
    const bucket = storage.bucket();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${BUCKET_PATH}/${safeName}`;
    const file = bucket.file(filePath);

    await file.save(buffer, {
      metadata: {
        contentType: mimeType,
        cacheControl: 'public, max-age=31536000',
      },
    });

    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
    return { url: publicUrl };
  } catch (err) {
    console.error('[firebaseStorage] Upload error:', err.message);
    return { error: err.message };
  }
}
