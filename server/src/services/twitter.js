import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OAuth from 'oauth-1.0a';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');

function getOAuth1() {
  const apiKey = config.twitter?.apiKey;
  const apiSecret = config.twitter?.apiSecret;
  if (!apiKey || !apiSecret) return null;
  return OAuth({
    consumer: { key: config.twitter.apiKey, secret: config.twitter.apiSecret },
    signature_method: 'HMAC-SHA1',
    hash_function(base_string, key) {
      return crypto.createHmac('sha1', key).update(base_string).digest('base64');
    },
  });
}

function signOAuth1Request(method, url, oauthToken, oauthTokenSecret, body = null) {
  const oauth = getOAuth1();
  if (!oauth) return null;
  const request = { url, method, data: body || {} };
  const auth = oauth.authorize(request, { key: oauthToken, secret: oauthTokenSecret });
  return oauth.toHeader(auth);
}

/**
 * Generate PKCE Code Verifier and Challenge
 */
export function generatePKCEChallenge() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
  return { verifier, challenge };
}

/**
 * Verify Twitter credentials and get user profile using OAuth 2.0
 * @param {string} accessToken - User access token (OAuth 2.0)
 * @returns {Promise<{ id?: string, username?: string, name?: string, profilePicture?: string } | null>}
 */
export async function verifyTwitterCredentials(accessToken) {
  try {
    const { data } = await axios.get('https://api.x.com/2/users/me', {
      params: {
        'user.fields': 'profile_image_url,username,name'
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!data || !data.data) return null;

    return {
      id: data.data.id,
      username: data.data.username,
      name: data.data.name,
      profilePicture: data.data.profile_image_url
    };
  } catch (err) {
    console.error('Twitter Credentials Verification Error:', err.response?.data || err.message);
    return null;
  }
}

/**
 * Upload image to Twitter and get media_id (for attaching to tweets)
 * Uses OAuth 1.0a when accessTokenSecret + oauth1AccessToken are provided; otherwise tries OAuth 2.0 Bearer.
 * @param {string} accessToken - OAuth 2.0 Bearer token (or OAuth 1.0a token when using oauth1)
 * @param {string} imageUrl - Public URL of the image
 * @param {object} opts - { accessTokenSecret, oauth1AccessToken } for OAuth 1.0a media upload
 * @returns {Promise<{ mediaId?: string, error?: string }>}
 */
export async function uploadMedia(accessToken, imageUrl, opts = {}) {
  const { accessTokenSecret, oauth1AccessToken } = opts;
  const useOAuth1 = accessTokenSecret && (oauth1AccessToken || accessToken) && getOAuth1();

  try {
    let buffer;
    let contentType = 'image/png';

    // If URL path is /uploads/xxx, read from local disk (avoids 404 when ngrok URL is stale)
    const uploadsMatch = imageUrl && (imageUrl.match(/\/uploads\/([^/?#]+)$/) || imageUrl.match(/uploads\/([^/?#]+)$/));
    if (uploadsMatch) {
      const filename = uploadsMatch[1];
      const filepath = path.join(UPLOADS_DIR, filename);
      if (fs.existsSync(filepath)) {
        buffer = fs.readFileSync(filepath);
        const ext = path.extname(filename).toLowerCase();
        if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
        else if (ext === '.gif') contentType = 'image/gif';
        else if (ext === '.webp') contentType = 'image/webp';
      }
    }

    if (!buffer) {
      const headers = imageUrl && imageUrl.includes('ngrok') ? { 'ngrok-skip-browser-warning': '1' } : {};
      const imageRes = await axios.get(imageUrl, { responseType: 'arraybuffer', headers });
      buffer = Buffer.from(imageRes.data, 'binary');
      contentType = imageRes.headers['content-type'] || 'image/png';
    }

    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('media', buffer, { contentType, filename: 'image.png' });

    // OAuth 1.0a: v1.1 media upload (required for image posting)
    if (useOAuth1) {
      const oauthToken = oauth1AccessToken || accessToken;
      const authHeader = signOAuth1Request('POST', 'https://upload.twitter.com/1.1/media/upload.json', oauthToken, accessTokenSecret);
      if (!authHeader) return { error: 'OAuth 1.0a not configured. Add TWITTER_API_KEY and TWITTER_API_SECRET to .env' };

      try {
        const { data } = await axios.post('https://upload.twitter.com/1.1/media/upload.json', form, {
          headers: { ...form.getHeaders(), ...authHeader },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        });
        const mediaId = data?.media_id_string || data?.media_id;
        if (mediaId) {
          console.log('[twitter] Media upload succeeded via OAuth 1.0a');
          return { mediaId };
        }
      } catch (e) {
        const msg = e.response?.data?.errors?.[0]?.message || e.response?.data?.message || e.message;
        console.error('Twitter OAuth 1.0a Media Upload Error:', msg);
        return { error: msg || 'Media upload failed' };
      }
    }

    // OAuth 2.0 Bearer: use chunked upload (INIT → APPEND → FINALIZE) - works with OAuth 2.0 PKCE
    const uploadUrl = 'https://upload.twitter.com/1.1/media/upload.json';
    const headers = { Authorization: `Bearer ${accessToken}` };

    try {
      // Step 1: INIT
      const initForm = new (await import('form-data')).default();
      initForm.append('command', 'INIT');
      initForm.append('total_bytes', String(buffer.length));
      initForm.append('media_type', contentType);
      initForm.append('media_category', contentType.includes('gif') ? 'tweet_gif' : 'tweet_image');

      const { data: initData } = await axios.post(uploadUrl, initForm, {
        headers: { ...initForm.getHeaders(), ...headers },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      const mediaId = initData?.media_id_string || initData?.media_id;
      if (!mediaId) {
        return { error: initData?.errors?.[0]?.message || 'INIT failed' };
      }

      // Step 2: APPEND (single chunk for images)
      const appendForm = new (await import('form-data')).default();
      appendForm.append('command', 'APPEND');
      appendForm.append('media_id', mediaId);
      appendForm.append('segment_index', '0');
      appendForm.append('media', buffer, { contentType, filename: 'image.png' });

      await axios.post(uploadUrl, appendForm, {
        headers: { ...appendForm.getHeaders(), ...headers },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      // Step 3: FINALIZE
      const finalForm = new (await import('form-data')).default();
      finalForm.append('command', 'FINALIZE');
      finalForm.append('media_id', mediaId);

      const { data: finalData } = await axios.post(uploadUrl, finalForm, {
        headers: { ...finalForm.getHeaders(), ...headers },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      const finalMediaId = finalData?.media_id_string || finalData?.media_id || mediaId;
      if (finalMediaId) {
        console.log('[twitter] Media upload succeeded via OAuth 2.0 chunked upload');
        return { mediaId: finalMediaId };
      }
      return { error: finalData?.errors?.[0]?.message || 'FINALIZE failed' };
    } catch (e) {
      const msg = e.response?.data?.errors?.[0]?.message || e.response?.data?.detail || e.message;
      console.warn('[twitter] OAuth 2.0 media upload failed:', msg);
      return { error: msg || 'Media upload failed' };
    }
  } catch (err) {
    const msg = err.response?.data?.detail || err.response?.data?.errors?.[0]?.message || err.response?.data?.message || err.message;
    console.error('Twitter Media Upload Error:', msg);
    return { error: msg };
  }
}

/**
 * Create a post on Twitter/X using OAuth 2.0
 * @param {string} accessToken - User access token (OAuth 2.0)
 * @param {string} text - Post content (max 280 characters)
 * @param {string[]} mediaIds - Optional media IDs
 * @returns {Promise<{ id?: string, url?: string, error?: string }>}
 */
export async function createPost(accessToken, text, mediaIds = []) {
  try {
    if ((!text || text.trim().length === 0) && (!mediaIds || mediaIds.length === 0)) {
      return { error: 'Post text or media is required' };
    }

    if (text && text.length > 280) {
      return { error: 'Post text cannot exceed 280 characters' };
    }

    const body = { text: text?.trim() };
    if (mediaIds && mediaIds.length > 0) {
      body.media = { media_ids: mediaIds };
    }

    const { data } = await axios.post(
      'https://api.x.com/2/tweets',
      body,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (data.errors) {
      return { error: data.errors[0].message || 'Failed to create tweet' };
    }

    const tweetId = data.data?.id;
    // Note: To get the URL reliably, we might need the username, 
    // but the V2 response only returns ID and Text by default.
    // We can use the status ID URL format.
    const url = `https://x.com/i/status/${tweetId}`;

    return { id: tweetId, url };
  } catch (err) {
    const msg = err.response?.data?.errors?.[0]?.message || err.response?.data?.detail || err.message;
    console.error('Twitter Post Error:', msg);
    return { error: msg };
  }
}

/**
 * Refresh OAuth 2.0 access token using refresh token
 * Access tokens expire in 2 hours; use this to get a new one without user re-login.
 * @param {string} refreshToken - The stored refresh token
 * @returns {Promise<{ access_token?: string, refresh_token?: string, expires_in?: number, error?: string }>}
 */
export async function refreshAccessToken(refreshToken) {
  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.twitter.clientId,
    });

    const authHeader = Buffer.from(`${config.twitter.clientId}:${config.twitter.clientSecret}`).toString('base64');

    const { data } = await axios.post('https://api.x.com/2/oauth2/token', params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${authHeader}`,
      },
    });

    return data;
  } catch (err) {
    const msg = err.response?.data?.error_description || err.response?.data?.error || err.message;
    console.error('Twitter Token Refresh Error:', msg);
    return { error: msg };
  }
}

/**
 * Exchange authorization code for OAuth 2.0 tokens
 * @param {string} code - The auth code from callback
 * @param {string} codeVerifier - The PKCE verifier
 * @param {string} redirectUri - Must match the one in developer portal
 * @returns {Promise<any>}
 */
export async function exchangeOAuth2Code(code, codeVerifier, redirectUri) {
  try {
    const params = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: config.twitter.clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });

    // Twitter requires Basic Auth header with Client ID and Secret for OAuth 2.0 Confidential Clients
    const authHeader = Buffer.from(`${config.twitter.clientId}:${config.twitter.clientSecret}`).toString('base64');

    const { data } = await axios.post('https://api.x.com/2/oauth2/token', params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${authHeader}`
      },
    });

    return data;
  } catch (err) {
    const msg = err.response?.data || err.message;
    console.error('Twitter OAuth2 Exchange Error:', msg);
    return { error: msg };
  }
}

/**
 * Get a single tweet with public_metrics (for analytics)
 * Uses GET /2/tweets/:id with tweet.fields=public_metrics.
 * Tries OAuth 2.0 user token first; OAuth 1.0a when available; app Bearer as fallback.
 */
export async function getTweetWithMetrics(tweetId, accessToken, opts = {}) {
  const { accessTokenSecret, oauth1AccessToken } = opts;
  const id = String(tweetId).trim();
  if (!id) return null;

  const url = `https://api.x.com/2/tweets/${id}`;
  const params = { 'tweet.fields': 'public_metrics,created_at' };

  const doRequest = async (authHeader) => {
    const { data } = await axios.get(url, { params, headers: authHeader });
    return data;
  };

  // 1. Try OAuth 1.0a when we have both token and secret
  if (accessTokenSecret && (oauth1AccessToken || accessToken) && getOAuth1()) {
    const oauthToken = oauth1AccessToken || accessToken;
    const fullUrl = `${url}?${new URLSearchParams(params)}`;
    const authHeader = signOAuth1Request('GET', fullUrl, oauthToken, accessTokenSecret);
    if (authHeader) {
      try {
        return await doRequest(authHeader);
      } catch (err) {
        console.warn('[twitter] Analytics OAuth 1.0a:', err.response?.data || err.message);
      }
    }
  }

  // 2. Try OAuth 2.0 user token (most common)
  if (accessToken) {
    try {
      return await doRequest({ Authorization: `Bearer ${accessToken}` });
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail || err.response?.data?.errors?.[0]?.message || err.message;
      console.warn('[twitter] Analytics OAuth 2.0:', status, detail);
      if (status !== 401 && status !== 403) return null;
    }
  }

  // 3. Fallback: app Bearer token (for public tweets)
  const bearerToken = config.twitter?.bearerToken;
  if (bearerToken) {
    try {
      return await doRequest({ Authorization: `Bearer ${bearerToken}` });
    } catch (err) {
      console.warn('[twitter] Analytics Bearer fallback:', err.response?.data?.detail || err.message);
    }
  }

  return null;
}

/**
 * Search tweets (for keyword polling)
 * Tries OAuth 1.0a when available; then OAuth 2.0 user token; falls back to app Bearer token.
 */
export async function searchTweets(query, accessToken, opts = {}) {
  const { accessTokenSecret, oauth1AccessToken } = opts;
  const bearerToken = config.twitter?.bearerToken;
  const url = 'https://api.x.com/2/tweets/search/recent';
  const params = {
    query,
    max_results: 10,
    'tweet.fields': 'created_at,author_id,text,public_metrics',
    'user.fields': 'username,name',
    expansions: 'author_id',
  };

  const doRequest = async (authHeader) => {
    const { data } = await axios.get(url, { params, headers: authHeader });
    return data;
  };

  if (accessTokenSecret && (oauth1AccessToken || accessToken) && getOAuth1()) {
    const oauthToken = oauth1AccessToken || accessToken;
    const fullUrl = `${url}?${new URLSearchParams(params)}`;
    const authHeader = signOAuth1Request('GET', fullUrl, oauthToken, accessTokenSecret);
    if (authHeader) {
      try {
        return await doRequest(authHeader);
      } catch (err) {
        if (err.response?.status !== 401 && err.response?.status !== 403) {
          console.warn('Twitter search (OAuth 1.0a):', err.response?.data?.detail || err.message);
        }
        if (err.response?.status === 401 && bearerToken) {
          try {
            return await doRequest({ Authorization: `Bearer ${bearerToken}` });
          } catch (_) {}
        }
        throw err;
      }
    }
  }

  try {
    return await doRequest({ Authorization: `Bearer ${accessToken}` });
  } catch (err) {
    if (err.response?.status === 401 && bearerToken) {
      try {
        return await doRequest({ Authorization: `Bearer ${bearerToken}` });
      } catch (bearerErr) {
        console.warn('Twitter search (Bearer fallback):', bearerErr.response?.data?.detail || bearerErr.message);
      }
    }
    throw err;
  }
}

/**
 * Get personalized trends (requires OAuth 2.0 User Context)
 */
export async function getPersonalizedTrends(accessToken, opts = {}) {
  const { accessTokenSecret, oauth1AccessToken } = opts;
  const url = 'https://api.x.com/2/users/personalized_trends';
  const params = { 'personalized_trend.fields': 'category,post_count,trend_name,trending_since' };

  if (accessTokenSecret && (oauth1AccessToken || accessToken) && getOAuth1()) {
    const oauthToken = oauth1AccessToken || accessToken;
    const fullUrl = `${url}?${new URLSearchParams(params)}`;
    const authHeader = signOAuth1Request('GET', fullUrl, oauthToken, accessTokenSecret);
    if (!authHeader) return null;
    try {
      const { data } = await axios.get(fullUrl, { headers: authHeader });
      return data;
    } catch (err) {
      if (err.response?.status !== 401 && err.response?.status !== 403) {
        console.warn('Twitter personalized trends (OAuth 1.0a):', err.response?.data?.detail || err.message);
      }
      return null;
    }
  }

  try {
    const { data } = await axios.get(url, {
      params,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return data;
  } catch (err) {
    if (err.response?.status === 401 || err.response?.status === 403) return null;
    console.warn('Twitter personalized trends:', err.response?.data?.detail || err.message);
    return null;
  }
}

/**
 * OAuth 1.0a: Get request token (step 1 of 3-legged flow)
 * @returns {Promise<{ oauth_token?: string, oauth_token_secret?: string, error?: string }>}
 */
export async function getOAuth1RequestToken(redirectUri) {
  const oauth = getOAuth1();
  if (!oauth) return { error: 'OAuth 1.0a not configured. Add TWITTER_API_KEY and TWITTER_API_SECRET to .env' };

  try {
    const auth = oauth.authorize(
      { url: 'https://api.twitter.com/oauth/request_token', method: 'POST', data: { oauth_callback: redirectUri } },
      {}
    );
    const header = oauth.toHeader(auth);
    const res = await axios.post(
      'https://api.twitter.com/oauth/request_token',
      new URLSearchParams({ oauth_callback: redirectUri }).toString(),
      {
        headers: {
          ...header,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    const params = new URLSearchParams(res.data);
    return {
      oauth_token: params.get('oauth_token'),
      oauth_token_secret: params.get('oauth_token_secret'),
    };
  } catch (err) {
    const data = err.response?.data;
    const msg = typeof data === 'object' && data?.errors?.[0]?.message
      ? data.errors[0].message
      : typeof data === 'string'
        ? data
        : err.message || 'Twitter OAuth failed';
    console.error('Twitter OAuth 1.0a Request Token Error:', msg);
    return { error: msg };
  }
}

/**
 * OAuth 1.0a: Exchange verifier for access token (step 3)
 * @returns {Promise<{ oauth_token?: string, oauth_token_secret?: string, user_id?: string, screen_name?: string, error?: string }>}
 */
export async function exchangeOAuth1AccessToken(oauthToken, oauthVerifier, oauthTokenSecret) {
  const oauth = getOAuth1();
  if (!oauth) return { error: 'OAuth 1.0a not configured' };

  try {
    const auth = oauth.authorize(
      { url: 'https://api.twitter.com/oauth/access_token', method: 'POST' },
      { key: oauthToken, secret: oauthTokenSecret }
    );
    const header = oauth.toHeader(auth);
    const res = await axios.post(
      'https://api.twitter.com/oauth/access_token',
      new URLSearchParams({ oauth_verifier: oauthVerifier }).toString(),
      {
        headers: {
          ...header,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    const params = new URLSearchParams(res.data);
    return {
      oauth_token: params.get('oauth_token'),
      oauth_token_secret: params.get('oauth_token_secret'),
      user_id: params.get('user_id'),
      screen_name: params.get('screen_name'),
    };
  } catch (err) {
    const msg = err.response?.data || err.message;
    console.error('Twitter OAuth 1.0a Access Token Error:', msg);
    return { error: String(msg) };
  }
}
