import axios from 'axios';
import { config } from '../config.js';

/**
 * Exchange authorization code for Threads access token
 * @param {string} code - Authorization code from OAuth callback
 * @returns {Promise<{ access_token?: string, user_id?: string, error?: string }>}
 */
export async function exchangeCodeForToken(code) {
  try {
    const { data } = await axios.post(
      'https://graph.threads.net/oauth/access_token',
      new URLSearchParams({
        client_id: config.threads.appId,
        client_secret: config.threads.appSecret,
        grant_type: 'authorization_code',
        redirect_uri: config.threads.redirectUri,
        code,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    return {
      access_token: data.access_token,
      user_id: data.user_id,
    };
  } catch (err) {
    const msg = err.response?.data?.error_message || err.message;
    console.error('Threads Token Exchange Error:', msg);
    return { error: msg };
  }
}

/**
 * Get Threads user profile
 * @param {string} accessToken - Threads access token
 * @param {string} userId - Threads user ID
 * @returns {Promise<{ id?: string, username?: string, name?: string, error?: string }>}
 */
export async function getThreadsUser(accessToken, userId) {
  try {
    const { data } = await axios.get(`https://graph.threads.net/v1.0/${userId}`, {
      params: {
        fields: 'id,username',
        access_token: accessToken,
      },
    });

    return {
      id: data.id,
      username: data.username,
    };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('Threads User Error:', msg);
    return { error: msg };
  }
}

/**
 * Create a Threads media container (text post)
 * @param {string} accessToken - Threads access token
 * @param {string} userId - Threads user ID
 * @param {string} text - Post text (max 500 characters)
 * @param {object} options - Optional parameters (image_url, video_url, topic_tag, link_attachment, gif_attachment)
 * @returns {Promise<{ id?: string, error?: string }>}
 */
export async function createMediaContainer(accessToken, userId, text, options = {}) {
  try {
    if (!text || text.trim().length === 0) {
      return { error: 'Post text cannot be empty' };
    }

    if (text.length > 500) {
      return { error: 'Post text cannot exceed 500 characters' };
    }

    const params = new URLSearchParams({
      media_type: options.image_url ? 'IMAGE' : options.video_url ? 'VIDEO' : 'TEXT',
      text: text.trim(),
      access_token: accessToken,
    });

    if (options.image_url) {
      params.append('image_url', options.image_url);
    }

    if (options.video_url) {
      params.append('video_url', options.video_url);
    }

    if (options.topic_tag) {
      params.append('topic_tag', options.topic_tag);
    }

    if (options.link_attachment) {
      params.append('link_attachment', options.link_attachment);
    }

    if (options.gif_attachment) {
      params.append('gif_attachment', JSON.stringify(options.gif_attachment));
    }

    if (options.is_carousel_item) {
      params.append('is_carousel_item', 'true');
    }

    const { data } = await axios.post(
      `https://graph.threads.net/v1.0/${userId}/threads`,
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    if (data.error) {
      const errMsg = data.error.message || data.error.error_user_msg || 'Failed to create media container';
      const isFetchError = errMsg.includes('download') || errMsg.includes('fetch') || (data.error.code === 9004);
      const isNgrok = options?.image_url?.includes('ngrok');
      const hint = (isNgrok || isFetchError) ? ' Meta cannot fetch from ngrok free tier. Use ngrok paid or deploy to a public URL.' : '';
      return { error: errMsg + hint };
    }

    return { id: data.id };
  } catch (err) {
    const errData = err.response?.data;
    const errObj = errData?.error && typeof errData.error === 'object' ? errData.error : {};
    const msg = errObj.message || errObj.error_user_msg || errData?.error_message || (typeof errData?.error === 'string' ? errData.error : null) || err.message || 'An unknown error occurred';
    const isNgrok = options?.image_url?.includes('ngrok');
    const hint = isNgrok ? ' Meta cannot fetch from ngrok free tier. Use ngrok paid or deploy to a public URL.' : '';
    console.error('Threads Media Container Error:', msg + hint);
    return { error: msg + hint };
  }
}

/**
 * Create a carousel container
 * @param {string} accessToken - Threads access token
 * @param {string} userId - Threads user ID
 * @param {Array<string>} childrenIds - Array of media container IDs
 * @param {string} text - Optional text for the carousel
 * @returns {Promise<{ id?: string, error?: string }>}
 */
export async function createCarouselContainer(accessToken, userId, childrenIds, text = '') {
  try {
    if (!childrenIds || childrenIds.length < 2) {
      return { error: 'Carousel must have at least 2 items' };
    }

    if (childrenIds.length > 20) {
      return { error: 'Carousel cannot have more than 20 items' };
    }

    const params = new URLSearchParams({
      media_type: 'CAROUSEL',
      children: childrenIds.join(','),
      access_token: accessToken,
    });

    if (text) {
      params.append('text', text);
    }

    const { data } = await axios.post(
      `https://graph.threads.net/v1.0/${userId}/threads`,
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    if (data.error) {
      return { error: data.error.message || 'Failed to create carousel container' };
    }

    return { id: data.id };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('Threads Carousel Error:', msg);
    return { error: msg };
  }
}

/**
 * Publish a Threads media container
 * @param {string} accessToken - Threads access token
 * @param {string} userId - Threads user ID
 * @param {string} creationId - Media container ID to publish
 * @returns {Promise<{ id?: string, url?: string, error?: string }>}
 */
export async function publishThread(accessToken, userId, creationId) {
  try {
    // Wait for media to be processed (Threads API recommends 5–30s; use 8s for images)
    await new Promise(resolve => setTimeout(resolve, 8000));

    const params = new URLSearchParams({
      creation_id: creationId,
      access_token: accessToken,
    });

    const { data } = await axios.post(
      `https://graph.threads.net/v1.0/${userId}/threads_publish`,
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    if (data.error) {
      return { error: data.error.message || 'Failed to publish thread' };
    }

    const threadId = data.id;
    const url = `https://www.threads.net/@${userId}/post/${threadId}`;

    return { id: threadId, url };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('Threads Publish Error:', msg);
    return { error: msg };
  }
}

/**
 * Create and publish a text-only Threads post
 * @param {string} accessToken - Threads access token
 * @param {string} userId - Threads user ID
 * @param {string} text - Post text
 * @param {object} options - Optional parameters
 * @returns {Promise<{ id?: string, url?: string, error?: string }>}
 */
export async function createPost(accessToken, userId, text, options = {}) {
  try {
    // Step 1: Create media container
    const containerResult = await createMediaContainer(accessToken, userId, text, options);
    
    if (containerResult.error) {
      return { error: containerResult.error };
    }

    // Step 2: Publish the container
    const publishResult = await publishThread(accessToken, userId, containerResult.id);
    
    if (publishResult.error) {
      return { error: publishResult.error };
    }

    return publishResult;
  } catch (err) {
    const msg = err.message;
    console.error('Threads Post Error:', msg);
    return { error: msg };
  }
}
