import axios from 'axios';
import * as integrationRepo from '../db/repositories/integrationRepository.js';
import * as postRepo from '../db/postRepository.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { refreshAccessToken as refreshTwitterToken } from './twitter.js';
import { refreshLongLivedToken as refreshThreadsToken } from './threads.js';

const GRAPH_BASE = 'https://graph.facebook.com/v18.0';
const IG_GRAPH_BASE = 'https://graph.instagram.com/v18.0';
const LINKEDIN_REST = 'https://api.linkedin.com/rest';
const LINKEDIN_VERSION = '202506';
const THREADS_BASE = 'https://graph.threads.net/v1.0';
const TWITTER_BASE = 'https://api.twitter.com/2';

/**
 * Fetch Instagram media comments.
 * Supports both:
 *  - Business accounts via Facebook (instagramBusinessAccountId + instagramPageAccessToken)
 *  - Direct Instagram Login (platformUserId + accessToken via graph.instagram.com)
 */
async function fetchInstagramComments(igAccountId, token, useGraphFacebook = false) {
  const items = [];
  const base = useGraphFacebook ? GRAPH_BASE : IG_GRAPH_BASE;
  try {
    const { data: mediaData } = await axios.get(`${base}/${igAccountId}/media`, {
      params: {
        access_token: token,
        fields: 'id,caption,media_type,permalink,timestamp',
        limit: 20,
      },
    });
    const mediaList = mediaData.data || [];

    await Promise.allSettled(mediaList.map(async (media) => {
      try {
        const { data: commentData } = await axios.get(`${base}/${media.id}/comments`, {
          params: {
            access_token: token,
            fields: 'id,username,text,timestamp,from,like_count,replies{id,username,text,timestamp}',
          },
        });
        for (const c of (commentData.data || [])) {
          items.push({
            platform: 'instagram',
            id: c.id,
            postId: media.id,
            postPreview: (media.caption || '').slice(0, 80),
            permalink: media.permalink,
            author: c.from?.username || c.username || 'instagram_user',
            text: c.text,
            timestamp: c.timestamp,
            type: 'comment',
            likeCount: c.like_count || 0,
          });
          // Include top-level replies
          for (const r of (c.replies?.data || [])) {
            items.push({
              platform: 'instagram',
              id: r.id,
              postId: media.id,
              parentCommentId: c.id,
              postPreview: (media.caption || '').slice(0, 80),
              permalink: media.permalink,
              author: r.username || 'instagram_user',
              text: r.text,
              timestamp: r.timestamp,
              type: 'reply',
            });
          }
        }
      } catch (_) {}
    }));
  } catch (err) {
    console.error('Instagram comments fetch error:', err.response?.data?.error?.message || err.message);
  }
  return items;
}

/**
 * Build inbox items from a list of tweet objects (common formatter).
 */
function mapTweetsToItems(tweets, usersById, selfId, type = 'tweet') {
  return tweets.map((tweet) => {
    const author = usersById[tweet.author_id] || {};
    const isSelf = tweet.author_id === selfId;
    return {
      platform: 'twitter',
      id: tweet.id,
      postId: tweet.conversation_id || tweet.id,
      postPreview: tweet.text?.slice(0, 80) || '',
      author: author.name || author.username || (isSelf ? 'You' : 'Twitter user'),
      authorUsername: author.username,
      authorAvatar: author.profile_image_url,
      text: tweet.text,
      timestamp: tweet.created_at,
      type,
      likeCount: tweet.public_metrics?.like_count || 0,
      replyCount: tweet.public_metrics?.reply_count || 0,
      permalink: author.username
        ? `https://x.com/${author.username}/status/${tweet.id}`
        : `https://x.com/i/web/status/${tweet.id}`,
    };
  });
}

/**
 * Fetch Twitter/X activity for the inbox.
 *
 * Twitter API tiers:
 *   Free  – write + limited read (own tweets only via user context)
 *   Basic – GET /mentions, GET /search/recent (requires $100/mo plan)
 *
 * Strategy:
 *  1. Try GET /users/{id}/mentions  (Basic tier — works if user has elevated access)
 *  2. Fall back to GET /users/{id}/tweets — shows own recent tweets with reply counts
 *     so users can see activity even on free tier.
 *
 * Auto-refreshes expired tokens (2h TTL) using stored refreshToken.
 */
async function fetchTwitterMentions(integration) {
  const items = [];
  let { accessToken, refreshToken, platformUserId } = integration;
  if (!accessToken || !platformUserId) return { items };

  const tweetParams = {
    max_results: 25,
    'tweet.fields': 'author_id,created_at,text,conversation_id,public_metrics,in_reply_to_user_id',
    expansions: 'author_id',
    'user.fields': 'name,username,profile_image_url',
  };

  const doRequest = async (token, endpoint, params) => {
    const { data } = await axios.get(`${TWITTER_BASE}/${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` },
      params,
    });
    return data;
  };

  // Helper: try request, auto-refresh on 401
  let newToken = null;
  const tryRequest = async (endpoint, params) => {
    try {
      return await doRequest(accessToken, endpoint, params);
    } catch (err) {
      const status = err.response?.status;
      if (status === 401 && refreshToken) {
        try {
          const refreshed = await refreshTwitterToken(refreshToken);
          if (refreshed.access_token) {
            newToken = refreshed.access_token;
            accessToken = refreshed.access_token;
            if (refreshed.refresh_token) refreshToken = refreshed.refresh_token;
            return await doRequest(accessToken, endpoint, params);
          }
        } catch (re) {
          console.warn('[inbox] Twitter token refresh failed:', re.message);
        }
      }
      throw err;
    }
  };

  // 1. Try mentions (requires Basic tier)
  let mentionData = null;
  try {
    mentionData = await tryRequest(`users/${platformUserId}/mentions`, tweetParams);
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.detail || err.response?.data?.title || err.message;
    if (status === 403) {
      console.warn(`[inbox] Twitter mentions: 403 – API Basic tier required (${detail}). Falling back to user tweets.`);
    } else {
      console.warn(`[inbox] Twitter mentions error ${status}:`, detail);
    }
  }

  if (mentionData?.data?.length) {
    const usersById = Object.fromEntries((mentionData.includes?.users || []).map((u) => [u.id, u]));
    items.push(...mapTweetsToItems(mentionData.data, usersById, platformUserId, 'mention'));
  }

  // 2. Fallback / supplement: own recent tweets (always available on free tier)
  //    Only fetch if mentions failed OR returned nothing (keeps inbox populated)
  if (items.length === 0) {
    try {
      const tweetData = await tryRequest(`users/${platformUserId}/tweets`, {
        ...tweetParams,
        exclude: 'retweets,replies',
      });
      if (tweetData?.data?.length) {
        const usersById = Object.fromEntries((tweetData.includes?.users || []).map((u) => [u.id, u]));
        // Show own tweets that have replies (worth monitoring)
        const tweetsWithReplies = tweetData.data.filter((t) => (t.public_metrics?.reply_count || 0) > 0);
        const toMap = tweetsWithReplies.length > 0 ? tweetsWithReplies : tweetData.data.slice(0, 10);
        items.push(...mapTweetsToItems(toMap, usersById, platformUserId, 'tweet'));
      }
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail || err.message;
      console.warn(`[inbox] Twitter user tweets error ${status}:`, detail);
    }
  }

  return { items, newToken };
}

/**
 * Fetch Threads replies to the user's posts.
 * Also shows user's own recent threads if no replies found.
 * Auto-refreshes the long-lived token when it's near expiry.
 * Returns { items, newToken? }.
 */
async function fetchThreadsReplies(integration) {
  const items = [];
  let { accessToken, tokenExpiresAt, platformUserId } = integration;
  if (!accessToken) {
    console.warn('[inbox] Threads: no accessToken');
    return { items };
  }

  // Refresh Threads token if expiring within 7 days
  let newToken = null;
  if (tokenExpiresAt) {
    const expiresMs = new Date(tokenExpiresAt).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (!isNaN(expiresMs) && Date.now() + sevenDays > expiresMs) {
      try {
        const refreshed = await refreshThreadsToken(accessToken);
        if (refreshed?.access_token) {
          newToken = { access_token: refreshed.access_token, expires_in: refreshed.expires_in };
          accessToken = refreshed.access_token;
          console.log('[inbox] Threads token refreshed proactively.');
        }
      } catch (re) {
        console.warn('[inbox] Threads token refresh failed:', re.message);
      }
    }
  }

  try {
    // Use 'me' as the endpoint identifier (works for both numeric ID and 'me')
    const { data: threadsData } = await axios.get(`${THREADS_BASE}/me/threads`, {
      params: {
        access_token: accessToken,
        fields: 'id,text,timestamp,permalink,media_type,reply_count,like_count',
        limit: 15,
      },
    });

    const threads = threadsData.data || [];
    console.log(`[inbox] Threads: found ${threads.length} posts for user ${platformUserId || 'me'}`);

    if (threads.length === 0) {
      return { items, newToken };
    }

    // Fetch replies for each thread (requires threads_manage_replies — app review needed)
    // 500 "Application does not have permission" = app review pending; suppress per-thread noise
    let permissionDeniedLogged = false;
    const replyResults = await Promise.allSettled(threads.map(async (thread) => {
      try {
        const { data: repliesData } = await axios.get(`${THREADS_BASE}/${thread.id}/replies`, {
          params: {
            access_token: accessToken,
            fields: 'id,text,timestamp,username,permalink,like_count',
          },
        });
        return { thread, replies: repliesData.data || [] };
      } catch (replyErr) {
        const st = replyErr.response?.status;
        const msg = replyErr.response?.data?.error?.message || replyErr.message;
        // 500 "Application does not have permission" = threads_manage_replies not approved yet
        const isPermissionError = st === 500 || (msg && msg.toLowerCase().includes('permission'));
        if (isPermissionError) {
          if (!permissionDeniedLogged) {
            console.warn('[inbox] Threads: threads_manage_replies permission not yet approved by Meta. Replies not accessible. Own threads will be shown instead.');
            permissionDeniedLogged = true;
          }
        } else {
          console.warn(`[inbox] Threads replies for thread ${thread.id} error ${st}:`, msg);
        }
        return { thread, replies: [] };
      }
    }));

    let totalReplies = 0;
    for (const result of replyResults) {
      if (result.status !== 'fulfilled') continue;
      const { thread, replies } = result.value;
      for (const r of replies) {
        if (!r.text) continue;
        totalReplies++;
        items.push({
          platform: 'threads',
          id: r.id,
          postId: thread.id,
          postPreview: (thread.text || '').slice(0, 80),
          permalink: r.permalink || thread.permalink,
          author: r.username || 'Threads user',
          text: r.text,
          timestamp: r.timestamp,
          type: 'reply',
          likeCount: r.like_count || 0,
        });
      }
    }

    console.log(`[inbox] Threads: found ${totalReplies} replies total.`);

    // If no replies, surface the user's own threads as "recent posts" so inbox is not empty
    if (items.length === 0) {
      console.log('[inbox] Threads: no replies found – showing own recent threads as activity.');
      const myHandle = integration.platformUsername || integration.profile?.username || 'You';
      for (const thread of threads.slice(0, 10)) {
        if (!thread.text) continue;
        items.push({
          platform: 'threads',
          id: thread.id,
          postId: thread.id,
          postPreview: thread.text.slice(0, 80),
          permalink: thread.permalink,
          author: myHandle,
          text: thread.text,
          timestamp: thread.timestamp,
          type: 'post',
          likeCount: thread.like_count || 0,
          replyCount: thread.reply_count || 0,
        });
      }
    }
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.error?.message || err.response?.data?.error_description || err.message;
    if (status === 401) {
      console.warn('[inbox] Threads 401 – token invalid or expired:', msg);
    } else if (status === 403) {
      console.warn('[inbox] Threads 403 – missing permission (threads_manage_replies?):', msg);
    } else {
      console.error('[inbox] Threads fetch error', status, msg);
    }
  }

  return { items, newToken };
}

/**
 * Fetch LinkedIn comments on the user's posts using the Community Management / Social Actions API.
 * Handles both urn:li:ugcPost and urn:li:share URN formats.
 */
async function fetchLinkedInComments(accessToken, shareUrns) {
  const items = [];
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': LINKEDIN_VERSION,
  };

  for (const rawUrn of shareUrns) {
    // Normalize: prefer ugcPost URN format for Community Management API
    let targetUrn = rawUrn;
    if (!rawUrn.startsWith('urn:')) {
      targetUrn = `urn:li:ugcPost:${rawUrn}`;
    } else if (rawUrn.includes('urn:li:share:')) {
      // Also try ugcPost URN (Community Management API prefers it)
      targetUrn = rawUrn.replace('urn:li:share:', 'urn:li:ugcPost:');
    }

    const encodedUrn = encodeURIComponent(targetUrn);
    let elements = [];

    // Try REST API first (Community Management API)
    try {
      const { data } = await axios.get(
        `${LINKEDIN_REST}/socialActions/${encodedUrn}/comments`,
        { headers, params: { count: 50 } }
      );
      elements = data.elements || [];
    } catch (err) {
      if (err.response?.status === 404 || err.response?.status === 400) {
        // Fallback: try original URN format (urn:li:share:)
        try {
          const originalUrn = rawUrn.startsWith('urn:') ? rawUrn : `urn:li:share:${rawUrn}`;
          const { data: fallbackData } = await axios.get(
            `${LINKEDIN_REST}/socialActions/${encodeURIComponent(originalUrn)}/comments`,
            { headers, params: { count: 50 } }
          );
          elements = fallbackData.elements || [];
        } catch (_) {}
      } else if (err.response?.status !== 403) {
        console.error('LinkedIn comments fetch error:', err.response?.data?.message || err.message);
      }
    }

    for (const c of elements) {
      const msg = c.message?.text || '';
      const actorUrn = c.actor || '';
      const commentId = c.id;
      const commentUrn = c.commentUrn || `urn:li:comment:(${targetUrn},${commentId})`;

      // Try to extract name from actor miniProfile if present
      const actorName = c.actor$memberFullName
        || c.actorInfo?.firstName
        || actorUrn.split(':').pop()
        || 'LinkedIn User';

      items.push({
        platform: 'linkedin',
        id: commentUrn,
        commentId,
        postUrn: targetUrn,
        postId: targetUrn,
        postPreview: msg.slice(0, 80),
        author: actorName,
        authorUrn: actorUrn,
        text: msg,
        timestamp: c.created?.time ? new Date(c.created.time).toISOString() : null,
        type: 'comment',
        likeCount: c.likeCount || 0,
      });
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
 * Fetch all comments from connected platforms.
 * @param {string} userId
 * @param {Array} [clientIntegrations] - Optional pre-loaded integrations (avoids server Firestore)
 */
export async function fetchUnifiedInbox(userId, clientIntegrations = null) {
  let integrations;
  if (clientIntegrations?.length) {
    integrations = clientIntegrations.filter((i) => i.isActive !== false);
  } else {
    integrations = await integrationRepo.find({ userId, isActive: true });
  }
  const allItems = [];

  const fetchTasks = integrations.map(async (int) => {
    // ── Instagram ─────────────────────────────────────────────────────────
    if (int.platform === 'instagram') {
      // Path A: connected via Facebook (Business account)
      if (int.instagramBusinessAccountId && int.instagramPageAccessToken) {
        const items = await fetchInstagramComments(
          int.instagramBusinessAccountId,
          int.instagramPageAccessToken,
          true // use graph.facebook.com
        );
        items.forEach((i) => {
          i.accountName = int.facebookPageName || int.profile?.name || int.profile?.username || 'Instagram';
          allItems.push(i);
        });
      } else if (int.platformUserId && int.accessToken) {
        // Path B: connected via Instagram Login directly (graph.instagram.com)
        const items = await fetchInstagramComments(int.platformUserId, int.accessToken, false);
        items.forEach((i) => {
          i.accountName = int.profile?.username || int.platformUsername || 'Instagram';
          allItems.push(i);
        });
      }
    }

    // ── Facebook ──────────────────────────────────────────────────────────
    if (int.platform === 'facebook' && int.facebookPageId && int.facebookPageAccessToken) {
      const items = await fetchFacebookComments(int.facebookPageId, int.facebookPageAccessToken);
      items.forEach((i) => {
        i.accountName = int.facebookPageName || 'Facebook Page';
        allItems.push(i);
      });
    }

    // ── LinkedIn ──────────────────────────────────────────────────────────
    if (int.platform === 'linkedin' && int.accessToken) {
      let shareUrns = int.linkedinPostUrns?.length ? [...int.linkedinPostUrns] : [];
      if (!shareUrns.length) {
        try {
          const posts = await postRepo.find({ userId, status: 'published' }, { limit: 20 });
          for (const p of posts) {
            const platformIds = p.platformIds instanceof Map ? Object.fromEntries(p.platformIds) : (p.platformIds || {});
            const urn = platformIds.linkedin || p.linkedinPostUrn;
            if (urn) shareUrns.push(urn);
          }
        } catch (_) {}
      }
      if (shareUrns.length > 0) {
        const items = await fetchLinkedInComments(int.accessToken, shareUrns);
        items.forEach((i) => {
          i.accountName = int.profile?.name || 'LinkedIn';
          allItems.push(i);
        });
      }
    }

    // ── Twitter / X ───────────────────────────────────────────────────────
    if (int.platform === 'twitter') {
      if (!int.accessToken) {
        console.warn('[inbox] Twitter integration present but no accessToken');
      } else {
        console.log(`[inbox] Fetching Twitter activity for userId=${int.platformUserId || 'unknown'}`);
        const { items: twItems, newToken } = await fetchTwitterMentions(int);
        console.log(`[inbox] Twitter: got ${twItems.length} items`);
        twItems.forEach((i) => {
          i.accountName = int.profile?.username || int.platformUsername || 'Twitter';
          allItems.push(i);
        });
        // Note: token refresh persistence is best-effort; client should update its Firestore
        if (newToken) {
          try {
            await integrationRepo.findOneAndUpdate(
              { userId, platform: 'twitter' },
              { accessToken: newToken },
              { upsert: false, new: false }
            );
          } catch (_) {}
        }
      }
    }

    // ── Threads ───────────────────────────────────────────────────────────
    if (int.platform === 'threads') {
      if (!int.accessToken) {
        console.warn('[inbox] Threads integration present but no accessToken');
      } else {
        console.log(`[inbox] Fetching Threads activity for userId=${int.platformUserId || 'unknown'}, tokenExpiresAt=${int.tokenExpiresAt || 'not set'}`);
        const { items: thItems, newToken } = await fetchThreadsReplies(int);
        console.log(`[inbox] Threads: got ${thItems.length} items`);
        thItems.forEach((i) => {
          i.accountName = int.profile?.username || int.platformUsername || 'Threads';
          allItems.push(i);
        });
        // Persist refreshed token
        if (newToken?.access_token) {
          try {
            await integrationRepo.findOneAndUpdate(
              { userId, platform: 'threads' },
              {
                accessToken: newToken.access_token,
                tokenExpiresAt: new Date(Date.now() + (newToken.expires_in || 5184000) * 1000).toISOString(),
              },
              { upsert: false, new: false }
            );
          } catch (_) {}
        }
      }
    }
  });

  await Promise.allSettled(fetchTasks);

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

/**
 * Reply to a Twitter/X mention or tweet.
 * Uses Twitter API v2 POST /tweets with reply.in_reply_to_tweet_id.
 */
export async function replyToTwitterTweet(tweetId, replyText, accessToken) {
  try {
    await axios.post(
      `${TWITTER_BASE}/tweets`,
      { text: replyText, reply: { in_reply_to_tweet_id: tweetId } },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
    return { ok: true };
  } catch (err) {
    const msg = err.response?.data?.detail || err.response?.data?.title || err.message;
    return { error: msg };
  }
}

/**
 * Reply to a Threads post or comment.
 * Step 1: Create a reply container. Step 2: Publish it.
 */
export async function replyToThreadsPost(threadId, replyText, accessToken) {
  try {
    // Step 1: Create reply container
    const { data: createData } = await axios.post(
      `${THREADS_BASE}/me/threads`,
      null,
      {
        params: {
          media_type: 'TEXT',
          text: replyText,
          reply_to_id: threadId,
          access_token: accessToken,
        },
      }
    );
    const containerId = createData?.id;
    if (!containerId) return { error: 'Failed to create reply container' };

    // Step 2: Publish the reply
    await axios.post(
      `${THREADS_BASE}/me/threads_publish`,
      null,
      { params: { creation_id: containerId, access_token: accessToken } }
    );
    return { ok: true };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    return { error: msg };
  }
}
