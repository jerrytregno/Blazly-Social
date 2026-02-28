import axios from 'axios';
import { config } from '../config.js';

const REDDIT_BASE = 'https://oauth.reddit.com';
const REDDIT_AUTH = 'https://www.reddit.com/api/v1';

/**
 * Exchange authorization code for Reddit access + refresh tokens
 * @param {string} code - Authorization code from OAuth callback
 * @returns {Promise<{ access_token?: string, refresh_token?: string, expires_in?: number, error?: string }>}
 */
export async function exchangeCodeForToken(code) {
  try {
    const auth = Buffer.from(`${config.reddit.clientId}:${config.reddit.clientSecret}`).toString('base64');

    const { data } = await axios.post(
      `${REDDIT_AUTH}/access_token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.reddit.redirectUri,
      }),
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': config.reddit.userAgent,
        },
      }
    );

    if (data.error) {
      return { error: data.error };
    }

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
    };
  } catch (err) {
    const msg = err.response?.data?.error || err.message;
    console.error('Reddit Token Exchange Error:', msg);
    return { error: msg };
  }
}

/**
 * Refresh Reddit access token using refresh token
 * @param {string} refreshToken - Reddit refresh token
 * @returns {Promise<{ access_token?: string, expires_in?: number, error?: string }>}
 */
export async function refreshAccessToken(refreshToken) {
  try {
    const auth = Buffer.from(`${config.reddit.clientId}:${config.reddit.clientSecret}`).toString('base64');

    const { data } = await axios.post(
      `${REDDIT_AUTH}/access_token`,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': config.reddit.userAgent,
        },
      }
    );

    if (data.error) {
      return { error: data.error };
    }

    return {
      access_token: data.access_token,
      expires_in: data.expires_in,
    };
  } catch (err) {
    const msg = err.response?.data?.error || err.message;
    console.error('Reddit Token Refresh Error:', msg);
    return { error: msg };
  }
}

/**
 * Get Reddit user identity
 * @param {string} accessToken - Reddit access token
 * @returns {Promise<{ id?: string, name?: string, icon_img?: string, error?: string }>}
 */
export async function getRedditUser(accessToken) {
  try {
    const { data } = await axios.get(`${REDDIT_BASE}/api/v1/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': config.reddit.userAgent,
      },
    });

    return {
      id: data.id,
      name: data.name,
      icon_img: data.icon_img ? data.icon_img.split('?')[0] : null,
    };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    console.error('Reddit User Error:', msg);
    return { error: msg };
  }
}

/**
 * Get list of subreddits the user moderates or subscribes to
 * @param {string} accessToken - Reddit access token
 * @returns {Promise<Array<{ name: string, display_name: string, subscribers: number }>>}
 */
export async function getUserSubreddits(accessToken) {
  try {
    const { data } = await axios.get(`${REDDIT_BASE}/subreddits/mine/subscriber?limit=100`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': config.reddit.userAgent,
      },
    });

    return (data.data?.children || []).map((child) => ({
      name: child.data.display_name_prefixed,
      display_name: child.data.display_name,
      subscribers: child.data.subscribers,
      icon_img: child.data.icon_img || child.data.community_icon?.split('?')[0],
    }));
  } catch (err) {
    console.error('Reddit Subreddits Error:', err.response?.data || err.message);
    return [];
  }
}

/**
 * Create a text post on Reddit
 * @param {string} accessToken - Reddit access token
 * @param {string} subreddit - Subreddit name (without r/ prefix)
 * @param {string} title - Post title (required by Reddit)
 * @param {string} text - Post body text (optional for self posts)
 * @returns {Promise<{ id?: string, url?: string, error?: string }>}
 */
export async function createPost(accessToken, subreddit, title, text = '') {
  try {
    if (!subreddit) {
      return { error: 'Subreddit is required' };
    }

    if (!title || title.trim().length === 0) {
      return { error: 'Post title is required for Reddit' };
    }

    if (title.length > 300) {
      return { error: 'Reddit post title cannot exceed 300 characters' };
    }

    const params = new URLSearchParams({
      api_type: 'json',
      kind: 'self',
      sr: subreddit,
      title: title.trim(),
      text: text.trim(),
    });

    const { data } = await axios.post(
      `${REDDIT_BASE}/api/submit`,
      params.toString(),
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': config.reddit.userAgent,
        },
      }
    );

    if (data.json?.errors && data.json.errors.length > 0) {
      const errorMsg = data.json.errors.map((e) => e.join(': ')).join(', ');
      return { error: errorMsg };
    }

    const postData = data.json?.data;
    const postId = postData?.id || postData?.name;
    const url = postData?.url || `https://www.reddit.com${postData?.permalink || ''}`;

    return { id: postId, url };
  } catch (err) {
    const msg = err.response?.data?.json?.errors?.[0]?.join(': ') || err.response?.data?.message || err.message;
    console.error('Reddit Post Error:', msg);
    return { error: msg };
  }
}
