import axios from 'axios';
import * as integrationRepo from '../db/repositories/integrationRepository.js';
import * as keywordPollRepo from '../db/keywordPollRepository.js';
import * as keywordMatchRepo from '../db/keywordMatchRepository.js';
import { searchTweets } from './twitter.js';

const LINKEDIN_REST = 'https://api.linkedin.com/rest';

/**
 * Poll LinkedIn Ad Library for keywords
 * GET /rest/adLibrary?q=criteria&keyword=...
 */
async function pollLinkedInAdLibrary(userId, keywords, integration) {
  if (!keywords?.length || !integration?.accessToken) return [];

  const matches = [];
  const headers = {
    Authorization: `Bearer ${integration.accessToken}`,
    'X-RestLi-Protocol-Version': '2.0.0',
    'LinkedIn-Version': '202506',
  };

  for (const keyword of keywords) {
    const q = keyword.trim();
    if (!q) continue;
    try {
      // LinkedIn Ad Library finder. Try without countries first (optional per schema).
      const parts = [
        'q=criteria',
        `keyword=${encodeURIComponent(q)}`,
        'count=8',
        'start=0',
      ];
      const url = `${LINKEDIN_REST}/adLibrary?${parts.join('&')}`;
      const { data } = await axios.get(url, { headers });
      const elements = data.elements || [];

      for (const el of elements) {
        const adUrl = el.adUrl || el.details?.advertiser?.advertiserUrl;
        const adId = adUrl?.split('/').pop() || el.adUrl;
        const existing = await safeFindMatch({ userId, platform: 'linkedin', postId: adId });
        if (existing) continue;

        const advertiser = el.details?.advertiser?.advertiserName || 'Unknown';
        const postUrl = el.adUrl || `https://www.linkedin.com/ad-library/detail/${adId}`;
        await safeCreateMatch({
          userId,
          keyword: q,
          platform: 'linkedin',
          postId: adId,
          postUrl,
          postText: advertiser ? `Ad by ${advertiser}` : null,
          authorUsername: advertiser,
          authorName: advertiser,
        });
        matches.push({ keyword: q, platform: 'linkedin', postId: adId, postUrl, authorName: advertiser });
      }
    } catch (err) {
      const errData = err.response?.data;
      const details = errData?.errorDetails || errData?.message || err.message;
      if (err.response?.status === 403 || err.response?.status === 404) {
        console.warn('Keyword poll LinkedIn Ad Library:', details);
        break;
      }
      // Invalid param often means: wrong param format, or app lacks Ad Library product access
      console.warn('Keyword poll LinkedIn error:', details, errData?.status ? `(status: ${errData.status})` : '');
    }
  }

  return matches;
}

/**
 * Poll Twitter for keywords and store matches
 * Uses OAuth 1.0a when available (fixes Unauthorized for OAuth 1.0a connections).
 */
async function pollTwitterForKeywords(userId, keywords, integration) {
  if (!keywords?.length || !integration?.accessToken) return [];

  const opts = {};
  if (integration.accessTokenSecret && integration.twitterOAuth1AccessToken) {
    opts.accessTokenSecret = integration.accessTokenSecret;
    opts.oauth1AccessToken = integration.twitterOAuth1AccessToken;
  }

  const matches = [];
  const seenTweetIds = new Set();

  for (const keyword of keywords) {
    const q = keyword.trim();
    if (!q) continue;
    try {
      const data = await searchTweets(q, integration.accessToken, opts);
      if (!data) continue;

      const users = (data.includes?.users || []).reduce((acc, u) => {
        acc[u.id] = u;
        return acc;
      }, {});

      for (const t of data.data || []) {
        if (seenTweetIds.has(t.id)) continue;
        seenTweetIds.add(t.id);
        const author = users[t.author_id];
        const existing = await safeFindMatch({ userId, platform: 'twitter', postId: t.id });
        if (existing) continue;

        await safeCreateMatch({
          userId,
          keyword: q,
          platform: 'twitter',
          postId: t.id,
          postUrl: `https://x.com/i/status/${t.id}`,
          postText: t.text?.slice(0, 500),
          authorUsername: author?.username,
          authorName: author?.name,
        });
        matches.push({ keyword: q, platform: 'twitter', postId: t.id, postUrl: `https://x.com/i/status/${t.id}`, postText: t.text?.slice(0, 300), authorUsername: author?.username, authorName: author?.name });
      }
    } catch (err) {
      if (err.response?.status === 403 || err.response?.status === 429) {
        console.warn('Keyword poll Twitter rate limit:', err.response?.data?.detail || err.message);
        break;
      }
      console.warn('Keyword poll Twitter error:', err.response?.data?.detail || err.message);
    }
  }

  return matches;
}

const GRAPH_BASE = 'https://graph.facebook.com/v18.0';

/**
 * Poll Instagram for keywords via hashtag search.
 *
 * IMPORTANT: ig_hashtag_search is a graph.facebook.com endpoint.
 * It requires:
 *   - A Facebook Business-connected Instagram account (instagramBusinessAccountId set)
 *   - A Facebook Page Access Token (instagramPageAccessToken), NOT a direct-login token
 *   - "Instagram Public Content Access" approved in Meta App Review
 *
 * For direct Instagram Login connections the token is a graph.instagram.com token and
 * is NOT compatible with ig_hashtag_search — attempting it always yields
 * "Invalid OAuth access token - Cannot parse access token".
 */
async function pollInstagramForKeywords(userId, keywords, integration) {
  if (!keywords?.length || !integration?.accessToken) return [];

  // Direct Instagram Login token is incompatible with ig_hashtag_search.
  // Only proceed when we have a Facebook-Business page access token.
  const isFacebookConnected = !!(integration.instagramBusinessAccountId && integration.instagramPageAccessToken);
  if (!isFacebookConnected) {
    console.warn('[Keyword poll] Instagram: hashtag search requires Facebook Business account connection + Public Content Access. Skipping for direct-login token.');
    return [];
  }

  const igUserId = integration.instagramBusinessAccountId;
  const token = integration.instagramPageAccessToken;

  const matches = [];
  for (const keyword of keywords) {
    const q = keyword.trim().replace(/^#/, '');
    if (!q) continue;
    try {
      const { data: searchData } = await axios.get(`${GRAPH_BASE}/ig_hashtag_search`, {
        params: { user_id: igUserId, q, access_token: token },
      });
      const hashtagId = searchData?.data?.[0]?.id;
      if (!hashtagId) continue;

      const { data: mediaData } = await axios.get(`${GRAPH_BASE}/${hashtagId}/recent_media`, {
        params: { user_id: igUserId, fields: 'id,media_type,permalink,caption', access_token: token, limit: 10 },
      });
      const media = mediaData?.data || [];
      for (const m of media) {
        const existing = await safeFindMatch({ userId, platform: 'instagram', postId: m.id });
        if (existing) continue;
        const postUrl = m.permalink || `https://www.instagram.com/p/${m.id}`;
        await safeCreateMatch({
          userId,
          keyword: q,
          platform: 'instagram',
          postId: m.id,
          postUrl,
          postText: (m.caption || '').slice(0, 500),
          authorUsername: null,
          authorName: null,
        });
        matches.push({ keyword: q, platform: 'instagram', postId: m.id, postUrl, postText: (m.caption || '').slice(0, 300) });
      }
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      if (err.response?.status === 400 || err.response?.status === 403) {
        console.warn('[Keyword poll] Instagram hashtag search (needs Public Content Access app review):', msg);
        break;
      }
      console.warn('[Keyword poll] Instagram error:', msg);
    }
  }
  return matches;
}

/**
 * Poll Facebook for keywords using two strategies:
 *
 *  1. SEARCH API: GET /search?q={keyword}&type=post — searches public posts (requires
 *     user access token; works for public Page posts and individual public posts).
 *
 *  2. PAGE FEED FALLBACK: GET /{pageId}/feed — the connected page's own feed including
 *     visitor posts. Used as a supplement when search returns nothing.
 *
 * Facebook removed general public post search in API v2.0 for apps, but the search
 * endpoint with type=post still works in limited scenarios with a valid user token.
 * If it fails (403/400), we fall back to the page feed search.
 */
async function pollFacebookForKeywords(userId, keywords, integration) {
  if (!keywords?.length || !integration?.accessToken) return [];

  // Prefer the user-level access token for broader search access
  const userToken = integration.accessToken;
  const pageToken = integration.facebookPageAccessToken;
  const pageId = integration.facebookPageId;

  if (!userToken && !pageToken) return [];

  const seenPostIds = new Set();
  const matches = [];

  /**
   * Try saving a match, deduplicating by postId.
   */
  const tryAddMatch = async (keyword, post) => {
    if (seenPostIds.has(post.id)) return;
    seenPostIds.add(post.id);
    const existing = await safeFindMatch({ userId, platform: 'facebook', postId: post.id });
    if (existing) return;
    const postUrl = post.permalink_url || post.link || `https://www.facebook.com/${post.id}`;
    const postText = (post.message || post.story || post.description || '').slice(0, 500);
    const authorName = post.from?.name || post.name || null;
    await safeCreateMatch({ userId, keyword, platform: 'facebook', postId: post.id, postUrl, postText, authorName });
    matches.push({ keyword, platform: 'facebook', postId: post.id, postUrl, postText: postText.slice(0, 300), authorName });
  };

  // ── Strategy 1: Search public Pages matching the keyword, then scan their posts ──
  // GET /search?q={keyword}&type=page — finds public pages by name/topic.
  // GET /{page-id}/posts — gets recent posts from those pages.
  // type=post search is unavailable to regular apps (returns 400).
  let pageSearchWorked = false;
  const allCandidatePosts = [];

  for (const keyword of keywords) {
    const q = keyword.trim();
    if (!q) continue;
    try {
      const { data: pageSearchData } = await axios.get(`${GRAPH_BASE}/search`, {
        params: {
          q,
          type: 'page',
          fields: 'id,name,about',
          access_token: userToken || pageToken,
          limit: 5,
        },
      });
      const pages = pageSearchData?.data || [];
      console.log(`[Keyword poll] Facebook page search "${q}": ${pages.length} related pages`);
      pageSearchWorked = true;

      // For each found page, fetch their recent posts
      for (const page of pages) {
        try {
          const { data: postsData } = await axios.get(`${GRAPH_BASE}/${page.id}/posts`, {
            params: {
              fields: 'id,message,story,permalink_url,created_time,from',
              access_token: userToken || pageToken,
              limit: 10,
            },
          });
          for (const p of (postsData.data || [])) {
            // Tag the post with the keyword that found its parent page + page name
            p._keyword = q;
            p._pageName = page.name;
            allCandidatePosts.push(p);
          }
        } catch (_) {} // Skip pages we can't read
      }
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.error?.message || err.message;
      console.warn(`[Keyword poll] Facebook page search unavailable (${status}): ${msg}`);
      break;
    }
  }

  // Match keyword against the posts fetched from related pages
  if (pageSearchWorked && allCandidatePosts.length > 0) {
    for (const p of allCandidatePosts) {
      const text = ((p.message || '') + ' ' + (p.story || '') + ' ' + (p._pageName || '')).toLowerCase();
      for (const keyword of keywords) {
        if (!text.includes(keyword.trim().toLowerCase())) continue;
        await tryAddMatch(keyword.trim(), p);
      }
    }
  }

  // ── Strategy 2: Page feed scan (own page + visitor posts) ────────────────
  if (pageId && (pageToken || userToken)) {
    let feedPosts = [];
    try {
      const { data } = await axios.get(`${GRAPH_BASE}/${pageId}/feed`, {
        params: {
          fields: 'id,message,story,permalink_url,created_time,from',
          access_token: pageToken || userToken,
          limit: 100,
        },
      });
      feedPosts = data?.data || [];
      // Filter out system auto-posts (cover/profile photo updates)
      feedPosts = feedPosts.filter((p) => p.message && p.message.length > 10);
      console.log(`[Keyword poll] Facebook page feed: ${feedPosts.length} real posts from page ${pageId}`);
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      console.warn('[Keyword poll] Facebook page feed error:', msg);
    }

    for (const keyword of keywords) {
      const q = keyword.trim().toLowerCase();
      if (!q) continue;
      for (const p of feedPosts) {
        const text = ((p.message || '') + ' ' + (p.story || '')).toLowerCase();
        if (!text.includes(q)) continue;
        await tryAddMatch(keyword.trim(), p);
      }
    }
  }

  console.log(`[Keyword poll] Facebook: ${matches.length} keyword matches found`);
  return matches;
}

/**
 * Poll Threads for keywords. Threads API has no public search - stub returns empty.
 * Future: Meta may add search capabilities.
 */
async function pollThreadsForKeywords(userId, keywords, integration) {
  if (!keywords?.length || !integration?.accessToken) return [];
  console.log('[Keyword poll] Threads: no public search API available');
  return [];
}

/**
 * Safe wrapper for keywordMatchRepo.create - doesn't throw on credential errors.
 * Returns the created match or null.
 */
async function safeCreateMatch(data) {
  try {
    return await keywordMatchRepo.create(data);
  } catch (_) {
    return null;
  }
}

/**
 * Safe wrapper for keywordMatchRepo.findOne - returns null on credential errors.
 */
async function safeFindMatch(query) {
  try {
    return await keywordMatchRepo.findOne(query);
  } catch (_) {
    return null;
  }
}

/**
 * Run keyword polling for a user across all platforms.
 * @param {string} userId
 * @param {object} opts - Optional override: { pollConfig, integrationsByPlatform }
 *   pollConfig: { keywords, platforms, enabled }
 *   integrationsByPlatform: { twitter, linkedin, instagram, facebook, threads }
 */
export async function runKeywordPoll(userId, opts = {}) {
  let keywords, platforms, pollId;

  if (opts.pollConfig) {
    // Use client-supplied config (avoids server-side Firestore read)
    keywords = opts.pollConfig.keywords;
    platforms = opts.pollConfig.platforms;
    pollId = null;
  } else {
    const poll = await keywordPollRepo.findOne({ userId });
    if (!poll?.enabled) return { matched: 0, message: 'Keyword poll not enabled' };
    if (!poll?.keywords?.length) return { matched: 0, message: 'No keywords configured' };
    keywords = poll.keywords;
    platforms = poll.platforms;
    pollId = poll._id;
  }

  if (!keywords?.length) return { matched: 0, message: 'No keywords configured' };
  platforms = platforms?.length ? platforms : ['twitter', 'linkedin'];

  // Build integration lookup - prefer client-supplied integrations
  const intByPlatform = opts.integrationsByPlatform || {};

  async function getIntegration(platform) {
    if (intByPlatform[platform]) return intByPlatform[platform];
    try {
      return await integrationRepo.findOne({ userId, platform, isActive: true });
    } catch (_) {
      return null;
    }
  }

  console.log('[Keyword poll] Run for user', userId, 'platforms:', platforms.join(','), 'keywords:', keywords.length);
  const allMatches = [];

  if (platforms.includes('twitter')) {
    const integration = await getIntegration('twitter');
    if (integration) {
      const m = await pollTwitterForKeywords(userId, keywords, integration);
      allMatches.push(...m);
    }
  }

  if (platforms.includes('linkedin')) {
    const integration = await getIntegration('linkedin');
    if (integration) {
      const m = await pollLinkedInAdLibrary(userId, keywords, integration);
      allMatches.push(...m);
    }
  }

  if (platforms.includes('instagram')) {
    const integration = await getIntegration('instagram');
    if (integration) {
      const m = await pollInstagramForKeywords(userId, keywords, integration);
      allMatches.push(...m);
    }
  }

  if (platforms.includes('facebook')) {
    const integration = await getIntegration('facebook');
    if (integration?.facebookPageId || integration?.accessToken) {
      const m = await pollFacebookForKeywords(userId, keywords, integration);
      allMatches.push(...m);
    }
  }

  if (platforms.includes('threads')) {
    const integration = await getIntegration('threads');
    if (integration) {
      const m = await pollThreadsForKeywords(userId, keywords, integration);
      allMatches.push(...m);
    }
  }

  if (pollId) {
    try { await keywordPollRepo.findByIdAndUpdate(pollId, { lastPolledAt: new Date() }); } catch (_) {}
  }

  return { matched: allMatches.length, matches: allMatches };
}
