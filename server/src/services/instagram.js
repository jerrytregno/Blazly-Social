import axios from 'axios';
import { config } from '../config.js';

const GRAPH_BASE = 'https://graph.facebook.com/v18.0';

/**
 * Exchange authorization code for Facebook access token (used for Instagram)
 * @param {string} code - Authorization code from OAuth callback
 * @param {string} redirectUri - Redirect URI used in the auth request
 * @returns {Promise<{ access_token?: string, expires_in?: number, error?: string }>}
 */
export async function exchangeCodeForToken(code, redirectUri) {
  try {
    const { data } = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
      params: {
        client_id: config.instagram.appId,
        client_secret: config.instagram.appSecret,
        redirect_uri: redirectUri,
        code,
      },
    });

    return {
      access_token: data.access_token,
      expires_in: data.expires_in,
    };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('Instagram Token Exchange Error:', msg);
    return { error: msg };
  }
}

/**
 * Exchange short-lived token for long-lived token (60 days)
 * @param {string} shortLivedToken - Short-lived user access token
 * @returns {Promise<{ access_token?: string, expires_in?: number, error?: string }>}
 */
export async function exchangeForLongLivedToken(shortLivedToken) {
  try {
    const { data } = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: config.instagram.appId,
        client_secret: config.instagram.appSecret,
        fb_exchange_token: shortLivedToken,
      },
    });
    return {
      access_token: data.access_token,
      expires_in: data.expires_in,
    };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('Instagram Long-Lived Token Error:', msg);
    return { error: msg };
  }
}

/**
 * Get Facebook user profile
 * @param {string} accessToken - Facebook access token
 * @returns {Promise<{ id?: string, name?: string, error?: string }>}
 */
export async function getFacebookUser(accessToken) {
  try {
    const { data } = await axios.get(`${GRAPH_BASE}/me`, {
      params: {
        access_token: accessToken,
        fields: 'id,name',
      },
    });

    return { id: data.id, name: data.name };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('Instagram FB User Error:', msg);
    return { error: msg };
  }
}

/**
 * Get Facebook Pages the user manages (to find linked Instagram accounts)
 * @param {string} accessToken - Facebook access token
 * @returns {Promise<Array<{ id: string, name: string, access_token: string, instagram_business_account?: { id: string } }>>}
 */
export async function getPagesWithInstagram(accessToken) {
  try {
    const { data } = await axios.get(`${GRAPH_BASE}/me/accounts`, {
      params: {
        access_token: accessToken,
        fields: 'id,name,access_token,instagram_business_account{id,username,profile_picture_url}',
      },
    });

    return (data.data || []).filter((page) => page.instagram_business_account);
  } catch (err) {
    console.error('Instagram Pages Error:', err.response?.data || err.message);
    return [];
  }
}

/**
 * Get Instagram Business Account info
 * @param {string} accessToken - Page access token
 * @param {string} igAccountId - Instagram Business Account ID
 * @returns {Promise<{ id?: string, username?: string, profile_picture_url?: string, error?: string }>}
 */
export async function getInstagramAccount(accessToken, igAccountId) {
  try {
    const { data } = await axios.get(`${GRAPH_BASE}/${igAccountId}`, {
      params: {
        access_token: accessToken,
        fields: 'id,username,profile_picture_url,name',
      },
    });

    return {
      id: data.id,
      username: data.username,
      profile_picture_url: data.profile_picture_url,
      name: data.name,
    };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('Instagram Account Error:', msg);
    return { error: msg };
  }
}

/**
 * Create a text-based Instagram post (caption-only posts require an image)
 * For text posts, we create a media container with a caption.
 * Note: Instagram API requires either an image_url or video_url.
 * For text-only posts from the automation tool, we post as a caption with a placeholder.
 * @param {string} pageAccessToken - Page access token
 * @param {string} igAccountId - Instagram Business Account ID
 * @param {string} caption - Post caption text
 * @param {string} imageUrl - Optional image URL (required by IG API for feed posts)
 * @returns {Promise<{ id?: string, url?: string, error?: string }>}
 */
export async function createPost(pageAccessToken, igAccountId, caption, imageUrl = '', baseUrl = GRAPH_BASE) {
  try {
    if (!igAccountId || !pageAccessToken) {
      return { error: 'Instagram Business Account and page access token are required.' };
    }

    if (!caption || caption.trim().length === 0) {
      return { error: 'Caption cannot be empty' };
    }

    if (caption.length > 2200) {
      return { error: 'Instagram caption cannot exceed 2200 characters' };
    }

    // Instagram Graph API requires an image_url or video_url for feed posts.
    // If no image is provided, we cannot create a standard feed post.
    // We'll attempt a caption-only approach or return an error.
    if (!imageUrl) {
      return { error: 'Instagram requires an image URL for feed posts. Please provide an image.' };
    }

    // Step 1: Create media container
    const { data: containerData } = await axios.post(
      `${baseUrl}/${igAccountId}/media`,
      null,
      {
        params: {
          image_url: imageUrl,
          caption: caption.trim(),
          access_token: pageAccessToken,
        },
      }
    );

    if (containerData.error) {
      return { error: containerData.error.message || 'Failed to create media container' };
    }

    const creationId = containerData.id;

    // Step 2: Publish the container (wait briefly for processing)
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const { data: publishData } = await axios.post(
      `${baseUrl}/${igAccountId}/media_publish`,
      null,
      {
        params: {
          creation_id: creationId,
          access_token: pageAccessToken,
        },
      }
    );

    if (publishData.error) {
      return { error: publishData.error.message || 'Failed to publish post' };
    }

    const postId = publishData.id;

    // Try to get the permalink
    try {
      const { data: mediaData } = await axios.get(`${baseUrl}/${postId}`, {
        params: {
          fields: 'permalink',
          access_token: pageAccessToken,
        },
      });
      return { id: postId, url: mediaData.permalink || `https://www.instagram.com/` };
    } catch {
      return { id: postId, url: `https://www.instagram.com/` };
    }
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('Instagram Post Error:', msg);
    return { error: msg };
  }
}

/**
 * Create a text-only post using Instagram's content publishing API (Stories or caption)
 * Since IG requires media for feed posts, this creates a text post attempt.
 * For automation purposes, the post is created with caption text.
 * @param {string} pageAccessToken
 * @param {string} igAccountId
 * @param {string} text
 * @returns {Promise<{ id?: string, url?: string, error?: string }>}
 */
export async function createTextPost(pageAccessToken, igAccountId, text) {
  // Instagram doesn't support text-only feed posts via API.
  // Return a descriptive error so the frontend can handle it gracefully.
  return {
    error: 'Instagram requires an image for feed posts. Text-only posts are not supported via the Instagram Graph API.',
  };
}

/**
 * Exchange authorization code for Instagram Business Account access token (Direct Instagram Login)
 * @param {string} code - Authorization code from OAuth callback
 * @param {string} redirectUri - Redirect URI used in the auth request
 * @returns {Promise<{ access_token?: string, user_id?: string, permissions?: string, error?: string }>}
 */
export async function exchangeInstagramLoginCode(code, redirectUri) {
  try {
    console.log('Instagram token exchange:', {
      client_id: config.instagram.appId,
      redirect_uri: redirectUri,
      code: code.substring(0, 20) + '...',
    });

    // Use a custom response transformer to handle potential bigint precision issues with user_id
    const response = await axios.post(
      'https://api.instagram.com/oauth/access_token',
      new URLSearchParams({
        client_id: config.instagram.appId,
        client_secret: config.instagram.appSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        transformResponse: [(data) => {
          // Keep raw data available so we can regex the ID
          return { raw: data, json: JSON.parse(data) };
        }]
      }
    );

    console.log('Full response from Instagram (raw):', response.data.raw);

    const data = response.data.json;

    // Extract user_id as string using regex from raw data to avoid precision loss
    let user_id = null;
    const userIdMatch = response.data.raw.match(/"user_id":\s*(\d+)/);
    if (userIdMatch) {
      user_id = userIdMatch[1];
    } else {
      user_id = data.user_id?.toString();
    }

    console.log('Extracted user_id as string:', user_id);

    // Handle both response formats: wrapped in data array or direct
    const tokenData = Array.isArray(data.data) ? data.data[0] : data;

    const shortLivedToken = tokenData?.access_token;
    const permissions = tokenData?.permissions;

    if (!shortLivedToken) {
      throw new Error(`No access token in response. Response was: ${JSON.stringify(data)}`);
    }

    // Step 2: Exchange short-lived token for long-lived token (60 days)
    console.log('Exchanging for long-lived token...');
    const longLivedResponse = await axios.get('https://graph.instagram.com/access_token', {
      params: {
        grant_type: 'ig_exchange_token',
        client_secret: config.instagram.appSecret,
        access_token: shortLivedToken,
      },
    });

    console.log('Long-lived token received:', {
      has_access_token: !!longLivedResponse.data.access_token,
      expires_in: longLivedResponse.data.expires_in,
    });

    const longLivedToken = longLivedResponse.data.access_token;

    // Step 3: The user_id from the initial token exchange IS the Instagram Business Account ID
    // No need to fetch it again - we already have it
    console.log('Account ID from token exchange:', user_id);
    console.log('Token exchange complete - ready to publish posts');

    return {
      access_token: longLivedToken,
      user_id: user_id, // This is the Instagram Business Account ID
      ig_user_id: user_id,
      permissions,
    };
  } catch (err) {
    const errorData = err.response?.data || {};
    const msg = errorData.error_message || errorData.error?.message || errorData.error || err.message;
    console.error('Instagram Login Token Exchange Error:', {
      status: err.response?.status,
      error: errorData,
      message: msg,
    });
    return { error: msg };
  }
}

/**
 * Create Instagram media container for images, videos, or carousel
 * @param {string} instagramUserId - Instagram professional account ID
 * @param {string} accessToken - Instagram user access token
 * @param {Object} mediaParams - Media parameters
 * @returns {Promise<{ id?: string, media_id?: string, error?: string }>}
 */
export async function createInstagramMediaContainer(instagramUserId, accessToken, mediaParams, baseUrl = 'https://graph.facebook.com/v18.0') {
  try {
    console.log('Creating Instagram media container:', {
      account_id: instagramUserId,
      media_type: mediaParams.media_type,
      has_image_url: !!mediaParams.image_url,
      has_video_url: !!mediaParams.video_url,
      has_caption: !!mediaParams.caption,
      has_children: !!mediaParams.children,
    });

    // Build the request payload - only include fields that are provided
    const payload = {};
    if (mediaParams.media_type) payload.media_type = mediaParams.media_type;
    if (mediaParams.image_url) payload.image_url = mediaParams.image_url;
    if (mediaParams.video_url) payload.video_url = mediaParams.video_url;
    if (mediaParams.caption) payload.caption = mediaParams.caption;
    if (mediaParams.children) payload.children = mediaParams.children;

    console.log('Media container request payload:', JSON.stringify(payload, null, 2));

    const { data } = await axios.post(
      `${baseUrl}/${instagramUserId}/media`,
      null,
      {
        params: {
          ...payload,
          access_token: accessToken
        },
        headers: { 'Accept': 'application/json' },
      }
    );

    console.log('Media container created successfully:', { container_id: data.id });
    return { id: data.id, media_id: data.id };
  } catch (err) {
    const errorData = err.response?.data || {};
    const nested = errorData.error?.error || errorData.error;
    let msg = nested?.message || errorData.error?.message || err.message;
    const code = nested?.code || errorData.error?.code;
    const isNgrokUrl = mediaParams.image_url && (mediaParams.image_url.includes('ngrok') || mediaParams.image_url.includes('localhost'));
    const isFetchError = (msg && (msg.includes('Only photo or video') || msg.includes('download') || msg.includes('fetch'))) || code === 9004;
    if (msg && (isFetchError || isNgrokUrl)) {
      msg += ' Meta cannot fetch from ngrok free tier or localhost. Use ngrok paid, deploy to a public URL, or host images on a CDN.';
    }
    console.error('Instagram Create Media Container Error:', msg);
    console.error('Full error details:', {
      status: err.response?.status,
      error: errorData,
      accountId: instagramUserId,
      mediaType: mediaParams.media_type,
    });
    return { error: msg };
  }
}

/**
 * Publish Instagram media container
 * @param {string} instagramUserId - Instagram professional account ID
 * @param {string} accessToken - Instagram user access token
 * @param {string} containerId - Media container ID
 * @returns {Promise<{ media_id?: string, error?: string }>}
 */
export async function publishInstagramMedia(instagramUserId, accessToken, containerId, baseUrl = 'https://graph.facebook.com/v18.0') {
  try {
    console.log('Publishing Instagram media:', { container_id: containerId });

    const { data } = await axios.post(
      `${baseUrl}/${instagramUserId}/media_publish`,
      null,
      {
        params: {
          creation_id: containerId,
          access_token: accessToken
        },
        headers: { 'Accept': 'application/json' },
      }
    );

    console.log('Media published:', { media_id: data.id });
    return { media_id: data.id };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('Instagram Publish Media Error:', msg);
    console.error('Full error:', err.response?.data || err.message);
    return { error: msg };
  }
}

/**
 * Check Instagram media container publishing status
 * @param {string} containerId - Media container ID
 * @param {string} accessToken - Instagram user access token
 * @returns {Promise<{ status_code?: string, error?: string }>}
 */
export async function checkInstagramMediaStatus(containerId, accessToken, baseUrl = 'https://graph.facebook.com/v18.0') {
  try {
    const { data } = await axios.get(
      `${baseUrl}/${containerId}`,
      {
        params: {
          fields: 'status_code',
          access_token: accessToken,
        },
      }
    );

    return { status_code: data.status_code };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('Instagram Check Media Status Error:', msg);
    return { error: msg };
  }
}

/**
 * Wait for Instagram media container to be ready for publishing
 * @param {string} containerId 
 * @param {string} accessToken 
 * @param {string} baseUrl 
 * @param {number} maxRetries 
 * @returns {Promise<{ ready: boolean, error?: string }>}
 */
export async function waitForMediaReady(containerId, accessToken, baseUrl = 'https://graph.facebook.com/v18.0', maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    const status = await checkInstagramMediaStatus(containerId, accessToken, baseUrl);

    if (status.status_code === 'FINISHED') {
      return { ready: true };
    }

    if (status.status_code === 'ERROR') {
      return { ready: false, error: 'Media processing failed on Instagram servers.' };
    }

    // If not ready, wait and try again
    console.log(`Media not ready (status: ${status.status_code}), retry ${i + 1}/${maxRetries}...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  return { ready: false, error: 'Media processing timed out. Please try publishing again in a moment.' };
}

/**
 * Get Instagram publishing rate limit usage
 * @param {string} instagramUserId - Instagram professional account ID
 * @param {string} accessToken - Instagram user access token
 * @returns {Promise<{ quota_used?: number, quota_total?: number, error?: string }>}
 */
export async function getInstagramPublishingLimit(instagramUserId, accessToken) {
  try {
    const { data } = await axios.get(
      `https://graph.instagram.com/v18.0/${instagramUserId}/content_publishing_limit`,
      {
        params: { access_token: accessToken },
      }
    );

    // Handle both response formats
    const limitData = data.data?.[0] || data;
    return {
      quota_used: limitData?.quota_usage || 0,
      quota_total: limitData?.quota_total || 100,
    };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('Instagram Get Publishing Limit Error:', msg);
    return { quota_used: 0, quota_total: 100 };
  }
}

