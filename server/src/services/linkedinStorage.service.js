/**
 * Store LinkedIn post metadata in Firebase Storage for backup/archival.
 * Path: linkedin-posts/{userId}/{postId}.json
 */
import { storage } from '../firebase.js';

/**
 * Upload a LinkedIn post to Firebase Storage
 * @param {string} userId - User ID (Firestore doc id)
 * @param {object} post - Post document with content, platformIds, etc.
 * @returns {Promise<{ success: boolean, path?: string, error?: string }>}
 */
export async function storeLinkedInPostInFirebase(userId, post) {
  if (!storage) {
    return { success: false, error: 'Firebase Storage not initialized. Set FIREBASE_SERVICE_ACCOUNT_PATH in .env' };
  }

  try {
    const postId = post._id?.toString?.() || post.id || Date.now().toString();
    const platformIds = post.platformIds instanceof Map ? Object.fromEntries(post.platformIds) : (post.platformIds || {});
    const platformUrls = post.platformUrls instanceof Map ? Object.fromEntries(post.platformUrls) : (post.platformUrls || {});

    const payload = {
      postId,
      userId: userId.toString(),
      content: post.content || '',
      platforms: post.platforms || [],
      mediaType: post.mediaType || 'text',
      imageUrl: post.imageUrl || null,
      videoUrl: post.videoUrl || null,
      linkedinPostId: platformIds.linkedin || null,
      linkedinPostUrl: platformUrls.linkedin || null,
      publishedAt: post.publishedAt ? new Date(post.publishedAt).toISOString() : null,
      storedAt: new Date().toISOString(),
    };

    const path = `linkedin-posts/${userId}/${postId}.json`;
    const bucket = storage.bucket();
    const file = bucket.file(path);

    await file.save(JSON.stringify(payload, null, 2), {
      contentType: 'application/json',
      metadata: {
        cacheControl: 'private, max-age=31536000',
      },
    });

    return { success: true, path };
  } catch (err) {
    console.warn('[linkedinStorage] Failed to store post:', err.message);
    return { success: false, error: err.message };
  }
}
