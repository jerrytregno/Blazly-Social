/**
 * Upload files directly to Firebase Storage from the client.
 * Uses Storage rules – no backend/service account needed for images.
 */
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';
import { auth } from '../firebase';

/**
 * Upload a file to Firebase Storage. Requires user to be signed in (Firebase Auth).
 * @param {File} file
 * @param {string} [pathPrefix] - e.g. 'post' or 'ai'
 * @returns {Promise<{ url: string } | { error: string }>}
 */
export async function uploadFileToStorage(file, pathPrefix = 'post') {
  const user = auth.currentUser;
  if (!user) {
    return { error: 'Sign in required to upload. Use Google sign-in.' };
  }
  if (!storage) {
    return { error: 'Firebase Storage not configured.' };
  }

  try {
    const ext = (file.name && file.name.includes('.')) ? file.name.split('.').pop() : 'jpg';
    const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const filename = `${pathPrefix}-${safe}.${ext}`;
    const path = `uploads/${user.uid}/${filename}`;

    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file, {
      contentType: file.type || 'image/jpeg',
      customMetadata: { uploadedBy: user.uid },
    });

    const url = await getDownloadURL(storageRef);
    return { url };
  } catch (err) {
    console.error('[uploadToStorage]', err);
    return { error: err.message || 'Upload failed' };
  }
}

/**
 * Upload base64 image (e.g. from AI generation) to Firebase Storage.
 */
export async function uploadBase64ToStorage(base64Data, filename = 'ai-generated.png') {
  const user = auth.currentUser;
  if (!user) {
    return { error: 'Sign in required to upload. Use Google sign-in.' };
  }
  if (!storage) {
    return { error: 'Firebase Storage not configured.' };
  }

  try {
    const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const path = `uploads/${user.uid}/ai-${safe}.png`;

    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, bytes, {
      contentType: 'image/png',
      customMetadata: { uploadedBy: user.uid },
    });

    const url = await getDownloadURL(storageRef);
    return { url };
  } catch (err) {
    console.error('[uploadToStorage] base64', err);
    return { error: err.message || 'Upload failed' };
  }
}
