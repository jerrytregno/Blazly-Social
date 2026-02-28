import axios from 'axios';
import * as integrationRepo from '../db/repositories/integrationRepository.js';
import * as postRepo from '../db/postRepository.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GRAPH_BASE = 'https://graph.facebook.com/v18.0';
const LINKEDIN_REST = 'https://api.linkedin.com/rest';
const LINKEDIN_VERSION = '202506';

/**
 * Fetch Instagram media and their comments
 */
async function fetchInstagramComments(igAccountId, pageAccessToken) {
  const items = [];
  try {
    const { data: mediaData } = await axios.get(`${GRAPH_BASE}/${igAccountId}/media`, {
      params: {
        access_token: pageAccessToken,
        fields: 'id,caption,media_type,permalink,timestamp',
        limit: 20,
      },
    });
    const mediaList = mediaData.data || [];
    for (const media of mediaList) {
      try {
        const { data: commentData } = await axios.get(`${GRAPH_BASE}/${media.id}/comments`, {
          params: {
            access_token: pageAccessToken,
            fields: 'id,username,text,timestamp,from',
          },
        });
        const comments = commentData.data || [];
        for (const c of comments) {
          items.push({
            platform: 'instagram',
            id: c.id,
            postId: media.id,
            postPreview: (media.caption || '').slice(0, 80),
            permalink: media.permalink,
            author: c.from?.username || c.username || 'unknown',
            text: c.text,
            timestamp: c.timestamp,
            type: 'comment',
          });
        }
      } catch (_) {}
    }
  } catch (err) {
    console.error('Instagram comments fetch error:', err.response?.data || err.message);
  }
  return items;
}

/**
 * Fetch LinkedIn comments on the user's posts (from posts we've created)
 * Uses socialActions/comments API - see LinkedIn Comments API docs
 */
async function fetchLinkedInComments(accessToken, shareUrns) {
  const items = [];
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': LINKEDIN_VERSION,
  };

  for (const urn of shareUrns) {
    const targetUrn = urn.startsWith('urn:') ? urn : `urn:li:share:${urn}`;
    const encodedUrn = encodeURIComponent(targetUrn);
    try {
      const { data } = await axios.get(
        `${LINKEDIN_REST}/socialActions/${encodedUrn}/comments`,
        { headers }
      );
      const elements = data.elements || [];
      for (const c of elements) {
        const msg = c.message?.text || '';
        const actorUrn = c.actor || '';
        const commentId = c.id;
        const commentUrn = c.commentUrn || `urn:li:comment:(${targetUrn},${commentId})`;
        items.push({
          platform: 'linkedin',
          id: commentUrn,
          commentId,
          postUrn: targetUrn,
          postId: targetUrn,
          postPreview: msg.slice(0, 80),
          author: actorUrn.split(':').pop() || 'unknown',
          text: msg,
          timestamp: c.created?.time ? new Date(c.created.time).toISOString() : null,
          type: 'comment',
        });
      }
    } catch (err) {
      if (err.response?.status !== 404) {
        console.error('LinkedIn comments fetch error:', err.response?.data || err.message);
      }
    }
  }
  return items;
}

/**
 * Fetch Facebook Page posts and their comments
 */
async function fetchFacebookComments(pageId, pageAccessToken) {
  const items = [];
  try {
    const { data: feedData } = await axios.get(`${GRAPH_BASE}/${pageId}/feed`, {
      params: {
        access_token: pageAccessToken,
        fields: 'id,message,created_time,permalink_url',
        limit: 15,
      },
    });
    const posts = feedData.data || [];
    for (const post of posts) {
      try {
        const { data: commentData } = await axios.get(`${GRAPH_BASE}/${post.id}/comments`, {
          params: {
            access_token: pageAccessToken,
            fields: 'id,message,created_time,from',
          },
        });
        const comments = commentData.data || [];
        for (const c of comments) {
          items.push({
            platform: 'facebook',
            id: c.id,
            postId: post.id,
            postPreview: (post.message || '').slice(0, 80),
            permalink: post.permalink_url,
            author: c.from?.name || 'unknown',
            text: c.message,
            timestamp: c.created_time,
            type: 'comment',
          });
        }
      } catch (_) {}
    }
  } catch (err) {
    console.error('Facebook comments fetch error:', err.response?.data || err.message);
  }
  return items;
}

/**
 * Fetch all comments from connected platforms
 */
export async function fetchUnifiedInbox(userId) {
  const integrations = await integrationRepo.find({ userId, isActive: true });
  const allItems = [];

  for (const int of integrations) {
    if (int.platform === 'instagram' && int.instagramBusinessAccountId && int.instagramPageAccessToken) {
      const items = await fetchInstagramComments(int.instagramBusinessAccountId, int.instagramPageAccessToken);
      items.forEach((i) => {
        i.accountName = int.facebookPageName || int.profile?.username || 'Instagram';
        allItems.push(i);
      });
    }
    if (int.platform === 'facebook' && int.facebookPageId && int.facebookPageAccessToken) {
      const items = await fetchFacebookComments(int.facebookPageId, int.facebookPageAccessToken);
      items.forEach((i) => {
        i.accountName = int.facebookPageName || 'Facebook Page';
        allItems.push(i);
      });
    }
    if (int.platform === 'linkedin' && int.accessToken) {
      const posts = await postRepo.find(
        { userId, status: 'published' },
        { limit: 20 }
      );

      const shareUrns = [];
      for (const p of posts) {
        const platformIds = p.platformIds instanceof Map ? Object.fromEntries(p.platformIds) : (p.platformIds || {});
        const urn = platformIds.linkedin || p.linkedinPostUrn;
        if (urn) shareUrns.push(urn);
      }
      if (shareUrns.length > 0) {
        const items = await fetchLinkedInComments(int.accessToken, shareUrns);
        items.forEach((i) => {
          i.accountName = int.profile?.name || 'LinkedIn';
          allItems.push(i);
        });
      }
    }
  }

  allItems.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return allItems;
}

/**
 * Generate AI reply suggestion for a comment
 */
export async function generateAiReply(commentText, platform, customInstructions = null) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);

    const prompt = `Generate a short, professional, friendly reply to this ${platformName} comment. Be helpful and authentic. Keep it under 150 characters.

Comment: "${commentText}"

${customInstructions ? `Additional context: ${customInstructions}` : ''}

Return ONLY the reply text, no quotes or explanation.`;

    const result = await model.generateContent(prompt);
    const text = result.response?.text()?.trim() || '';
    return text.replace(/^["']|["']$/g, '');
  } catch (err) {
    console.error('AI reply error:', err);
    return '';
  }
}

/**
 * Reply to Instagram comment
 */
export async function replyToInstagramComment(commentId, replyText, pageAccessToken) {
  try {
    await axios.post(`${GRAPH_BASE}/${commentId}/replies`, null, {
      params: {
        access_token: pageAccessToken,
        message: replyText,
      },
    });
    return { ok: true };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    return { error: msg };
  }
}

/**
 * Reply to LinkedIn comment (socialActions/comments API)
 * commentId can be commentUrn or { postUrn, commentId } for nested
 */
export async function replyToLinkedInComment(postUrn, commentId, replyText, accessToken, parentCommentUrn = null) {
  const targetUrn = postUrn.startsWith('urn:') ? postUrn : `urn:li:share:${postUrn}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': LINKEDIN_VERSION,
  };

  const body = {
    object: targetUrn,
    message: { text: replyText },
  };
  if (parentCommentUrn) body.parentComment = parentCommentUrn;

  try {
    const url = `${LINKEDIN_REST}/socialActions/${targetUrn}/comments`;
    await axios.post(url, body, { headers });
    return { ok: true };
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    return { error: msg };
  }
}

/**
 * Reply to Facebook comment
 */
export async function replyToFacebookComment(commentId, replyText, pageAccessToken) {
  try {
    await axios.post(`${GRAPH_BASE}/${commentId}/comments`, null, {
      params: {
        access_token: pageAccessToken,
        message: replyText,
      },
    });
    return { ok: true };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    return { error: msg };
  }
}
