import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');

/**
 * Create a post on LinkedIn (Share on LinkedIn – UGC Post API v2).
 * Supports both text-only and image-based posts.
 * @param {string} accessToken - Member access token
 * @param {object} payload - { author (urn), commentary (text), visibility, mediaAsset (opt) }
 * @returns {Promise<{ postUrn?: string, error?: string }>}
 */
export async function createPost(accessToken, payload) {
  const body = {
    author: payload.author,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: payload.commentary },
        shareMediaCategory: payload.mediaAsset ? 'IMAGE' : 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility':
        payload.visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC',
    },
  };

  if (payload.mediaAsset) {
    body.specificContent['com.linkedin.ugc.ShareContent'].media = [
      {
        status: 'READY',
        description: { text: 'Post image' },
        media: payload.mediaAsset,
        title: { text: 'Post image' },
      },
    ];
  }

  try {
    const res = await axios.post('https://api.linkedin.com/v2/ugcPosts', body, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    const postUrn = res.headers?.['x-restli-id'] || res.data?.id;
    return { postUrn: postUrn || 'unknown' };
  } catch (err) {
    const message = err.response?.data?.message || err.message;
    const status = err.response?.status;
    return { error: message, status };
  }
}

/**
 * Register an image upload with LinkedIn
 * @param {string} accessToken 
 * @param {string} authorUrn 
 * @returns {Promise<{ uploadUrl: string, asset: string, error?: string }>}
 */
export async function registerImage(accessToken, authorUrn) {
  const body = {
    registerUploadRequest: {
      recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
      owner: authorUrn,
      serviceRelationships: [
        {
          relationshipType: 'OWNER',
          identifier: 'urn:li:userGeneratedContent',
        },
      ],
    },
  };

  try {
    const res = await axios.post('https://api.linkedin.com/v2/assets?action=registerUpload', body, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const uploadUrl = res.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
    const asset = res.data.value.asset;

    return { uploadUrl, asset };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    console.error('LinkedIn Image Registration Error:', msg);
    return { error: msg };
  }
}

/**
 * Upload image binary to LinkedIn
 * @param {string} uploadUrl 
 * @param {string} imageUrl - Remote image URL (e.g. Firebase)
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function uploadImage(uploadUrl, imageUrl) {
  try {
    let buffer;
    let contentType = 'image/png';

    // If URL path is /uploads/xxx, read from local disk (avoids 404 when ngrok URL is stale or unreachable)
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
      // Fallback: fetch via HTTP (add ngrok-skip-browser-warning for ngrok free tier)
      const headers = {};
      if (imageUrl && imageUrl.includes('ngrok')) {
        headers['ngrok-skip-browser-warning'] = '1';
      }
      const imageRes = await axios.get(imageUrl, { responseType: 'arraybuffer', headers });
      buffer = Buffer.from(imageRes.data, 'binary');
      contentType = imageRes.headers['content-type'] || 'image/png';
    }

    // 2. Upload to LinkedIn
    await axios.put(uploadUrl, buffer, {
      headers: {
        'Content-Type': contentType,
      },
    });

    return { success: true };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    console.error('LinkedIn Image Binary Upload Error:', msg);
    return { success: false, error: msg };
  }
}

/**
 * High-level function to create an image post on LinkedIn
 */
export async function createPostWithImage(accessToken, authorUrn, commentary, imageUrl, visibility = 'PUBLIC') {
  try {
    // Step 1: Register
    const reg = await registerImage(accessToken, authorUrn);
    if (reg.error) return { error: reg.error };

    // Step 2: Upload
    const upload = await uploadImage(reg.uploadUrl, imageUrl);
    if (!upload.success) return { error: upload.error };

    // Step 3: Create Post
    return await createPost(accessToken, {
      author: authorUrn,
      commentary,
      visibility,
      mediaAsset: reg.asset,
    });
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Build author URN for Share on LinkedIn (v2/ugcPosts).
 * UGC Post API expects Person URN: urn:li:person:{id}. Userinfo "sub" is alphanumeric and works here.
 */
export function buildAuthorUrn(memberId) {
  if (!memberId || typeof memberId !== 'string') return null;
  if (memberId.startsWith('urn:')) return memberId;
  return `urn:li:person:${memberId}`;
}

/**
 * Fetch current member via /v2/me (needs profile scope; often 403 with only w_member_social).
 */
export async function getMe(accessToken) {
  try {
    const { data } = await axios.get('https://api.linkedin.com/v2/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return { id: data.id, ...data };
  } catch (err) {
    return null;
  }
}

/**
 * Fetch member via OpenID Connect userinfo (works with openid + profile scope).
 * Returns { sub, name, given_name, family_name, picture } – use sub as linkedinId for author.
 */
export async function getUserInfo(accessToken) {
  try {
    const { data } = await axios.get('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return data;
  } catch (err) {
    return null;
  }
}

/**
 * Get member id for author URN: try /v2/me first, then OpenID userinfo (sub).
 */
export async function getMemberId(accessToken) {
  const me = await getMe(accessToken);
  if (me?.id) return { id: me.id, profile: me };
  const userinfo = await getUserInfo(accessToken);
  if (userinfo?.sub) return { id: userinfo.sub, profile: userinfo };
  return null;
}
