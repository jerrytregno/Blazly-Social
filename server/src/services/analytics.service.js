import axios from 'axios';
import * as integrationRepo from '../db/repositories/integrationRepository.js';
import * as postRepo from '../db/postRepository.js';
import { getTweetWithMetrics } from './twitter.js';
import { config } from '../config.js';

/**
 * Fetch LinkedIn post analytics using the user's access token.
 *
 * Two-app strategy:
 *  - App A (86swiutwriegdi)  → OAuth/posting. Token has w_member_social scope.
 *  - App B (862s62a5b7t1n1)  → Community Management. Once enabled by LinkedIn,
 *    the user re-connects LinkedIn to get a token with r_member_postAnalytics /
 *    r_organization_social scopes. Until then, we try all endpoints gracefully.
 *
 * Endpoint priority:
 *  1. memberShareStatistics  – personal post stats (needs r_member_postAnalytics)
 *  2. organizationalEntityShareStatistics – org page stats (needs r_organization_social)
 *  3. socialDetail on the ugcPost – public-ish data available to the post author
 */
async function fetchLinkedInAnalytics(postId, accessToken) {
  const urn = postId.startsWith('urn:') ? postId : `urn:li:ugcPost:${postId}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'LinkedIn-Version': '202506',
    'X-Restli-Protocol-Version': '2.0.0',
  };

  // Try 1: Member post analytics (r_member_postAnalytics — Community Management App B)
  try {
    const { data } = await axios.get(
      'https://api.linkedin.com/rest/memberShareStatistics',
      { params: { q: 'memberShares', 'memberShares[0]': urn }, headers }
    );
    const el = data.elements?.[0];
    if (el) {
      const stats = el.totalShareStatistics || {};
      return {
        impressions: stats.impressionCount ?? 0,
        clicks: stats.clickCount ?? 0,
        likes: stats.likeCount ?? 0,
        comments: stats.commentCount ?? 0,
        shares: stats.shareCount ?? 0,
        engagement: stats.engagement ?? 0,
      };
    }
  } catch (err1) {
    const s = err1.response?.status;
    if (s !== 403 && s !== 404 && s !== 400) {
      console.warn('LinkedIn memberShareStatistics:', err1.response?.data?.message || err1.message);
    }
  }

  // Try 2: Organizational statistics (r_organization_social — Community Management App B)
  try {
    const { data } = await axios.get(
      'https://api.linkedin.com/rest/organizationalEntityShareStatistics',
      { params: { q: 'organizationalEntity', 'shares[0]': urn }, headers }
    );
    const el = data.elements?.[0];
    if (el) {
      const stats = el.totalShareStatistics || {};
      return {
        impressions: el.organicImpressionsCount ?? stats.impressionCount ?? 0,
        clicks: stats.clickCount ?? 0,
        likes: stats.likeCount ?? 0,
        comments: stats.commentCount ?? 0,
        shares: stats.shareCount ?? 0,
      };
    }
  } catch (err2) {
    const s = err2.response?.status;
    if (s !== 403 && s !== 404 && s !== 400) {
      console.warn('LinkedIn orgShareStatistics:', err2.response?.data?.message || err2.message);
    }
  }

  // Try 3: Fetch post social detail — available to post author with w_member_social
  try {
    const encodedUrn = encodeURIComponent(urn);
    const { data } = await axios.get(
      `https://api.linkedin.com/rest/posts/${encodedUrn}`,
      { headers }
    );
    if (data?.id) {
      // socialDetail lives in a separate call for the ugcPost (v2 API)
      try {
        const { data: detail } = await axios.get(
          `https://api.linkedin.com/v2/socialActions/${encodedUrn}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'X-Restli-Protocol-Version': '2.0.0',
            },
          }
        );
        if (detail) {
          return {
            impressions: 0,
            likes: detail.likesSummary?.totalLikes ?? 0,
            comments: detail.commentsSummary?.totalFirstLevelComments ?? 0,
            shares: detail.sharesSummary?.totalShares ?? 0,
          };
        }
      } catch (_) {}
    }
  } catch (_) {}

  return null;
}

/**
 * Fetch Instagram media analytics.
 *
 * Strategy (most permissive to least):
 *  1. Basic media fields (like_count, comments_count) — works with just instagram_basic.
 *     No `instagram_manage_insights` needed. Works for personal, Creator, and Business accounts.
 *  2. Insights endpoint for impressions/reach — requires instagram_manage_insights.
 *     Only attempted when account type allows it; failure is silently ignored.
 *
 * NOTE: `engagement` is NOT a valid metric name for the Instagram Insights API.
 * Valid feed/reel metrics: impressions, reach, likes, comments, saved, shares,
 *   total_interactions, plays (reels only), profile_visits, profile_activity.
 *
 * @param {boolean} useFacebookHost - Use graph.facebook.com (for Page/Business tokens)
 */
async function fetchInstagramAnalytics(mediaId, accessToken, useFacebookHost = false) {
  const baseUrl = useFacebookHost ? 'https://graph.facebook.com/v18.0' : 'https://graph.instagram.com/v18.0';
  const result = {};

  // ── Step 1: Basic media fields (no insights permission needed) ───────────
  try {
    const { data: mediaData } = await axios.get(`${baseUrl}/${mediaId}`, {
      params: {
        fields: 'like_count,comments_count,media_type,timestamp',
        access_token: accessToken,
      },
    });
    if (mediaData.like_count != null) result.likes = mediaData.like_count;
    if (mediaData.comments_count != null) result.comments = mediaData.comments_count;
    if (mediaData.media_type) result.mediaType = mediaData.media_type;
  } catch (basicErr) {
    const msg = basicErr.response?.data?.error?.message || basicErr.message;
    console.warn('[analytics] Instagram basic media fetch:', msg);
    // If the basic fetch fails (wrong ID, deleted, no permission) return null immediately
    return null;
  }

  // ── Step 2: Insights for impressions/reach (requires instagram_manage_insights) ──
  // Use only valid metric names — `engagement` is NOT valid for this endpoint.
  const isReel = result.mediaType === 'VIDEO';
  const insightMetrics = isReel
    ? 'plays,reach,total_interactions,likes,comments,saved,shares'
    : 'impressions,reach,total_interactions,likes,comments,saved,shares';

  try {
    const { data: insightsData } = await axios.get(`${baseUrl}/${mediaId}/insights`, {
      params: {
        metric: insightMetrics,
        period: 'lifetime',
        access_token: accessToken,
      },
    });
    const metrics = (insightsData?.data || []).reduce((acc, m) => {
      const val = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
      acc[m.name] = typeof val === 'number' ? val : 0;
      return acc;
    }, {});
    // Prefer insights values if available (more accurate than basic)
    if (metrics.impressions != null) result.impressions = metrics.impressions;
    if (metrics.reach != null) result.reach = metrics.reach;
    if (metrics.plays != null) result.plays = metrics.plays;
    if (metrics.total_interactions != null) result.totalInteractions = metrics.total_interactions;
    if (metrics.likes != null) result.likes = metrics.likes;
    if (metrics.comments != null) result.comments = metrics.comments;
    if (metrics.saved != null) result.saved = metrics.saved;
    if (metrics.shares != null) result.shares = metrics.shares;
  } catch (insightsErr) {
    // Insights failure is common (no instagram_manage_insights permission) — not an error
    const status = insightsErr.response?.status;
    const msg = insightsErr.response?.data?.error?.message || insightsErr.message;
    if (status !== 400 && status !== 403 && status !== 10 && status !== 100) {
      console.warn('[analytics] Instagram insights (optional):', msg);
    }
    // Continue — we still have basic likes/comments from step 1
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Fetch Facebook post analytics.
 *
 * Strategy:
 *  1. Try /insights endpoint (requires pages_read_engagement — approved permission).
 *     Valid metrics differ by post type; request only the safest subset.
 *  2. Fall back to basic post fields (likes.summary, comments.summary) — available
 *     with just pages_read_engagement or pages_show_list.
 */
async function fetchFacebookAnalytics(postId, pageAccessToken) {
  const GRAPH = 'https://graph.facebook.com/v18.0';
  const result = {};

  // ── Step 1: Basic post fields (likes/comments counts) ────────────────────
  try {
    const { data: postData } = await axios.get(`${GRAPH}/${postId}`, {
      params: {
        fields: 'likes.summary(true),comments.summary(true),reactions.summary(true)',
        access_token: pageAccessToken,
      },
    });
    if (postData.likes?.summary?.total_count != null) result.likes = postData.likes.summary.total_count;
    if (postData.reactions?.summary?.total_count != null) result.reactions = postData.reactions.summary.total_count;
    if (postData.comments?.summary?.total_count != null) result.comments = postData.comments.summary.total_count;
  } catch (basicErr) {
    const msg = basicErr.response?.data?.error?.message || basicErr.message;
    console.warn('[analytics] Facebook basic post fetch:', msg);
    return null;
  }

  // ── Step 2: Insights for impressions/reach (pages_read_engagement) ───────
  // Use only metrics available for regular page posts (not stories, ads, etc.)
  try {
    const { data: insightsData } = await axios.get(`${GRAPH}/${postId}/insights`, {
      params: {
        metric: 'post_impressions,post_impressions_unique,post_engaged_users',
        access_token: pageAccessToken,
      },
    });
    const metrics = (insightsData.data || []).reduce((acc, m) => {
      const val = m.values?.[0];
      if (typeof val?.value === 'number') acc[m.name] = val.value;
      else if (val?.value && typeof val.value === 'object') {
        acc[m.name] = Object.values(val.value).reduce((s, v) => s + (Number(v) || 0), 0);
      }
      return acc;
    }, {});
    if (metrics.post_impressions != null) result.impressions = metrics.post_impressions;
    if (metrics.post_impressions_unique != null) result.reach = metrics.post_impressions_unique;
    if (metrics.post_engaged_users != null) result.engagedUsers = metrics.post_engaged_users;
  } catch (insightsErr) {
    // Insights permission may not be granted — basic data is still valid
    const status = insightsErr.response?.status;
    const msg = insightsErr.response?.data?.error?.message || insightsErr.message;
    if (status !== 400 && status !== 403) {
      console.warn('[analytics] Facebook insights (optional):', msg);
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Fetch Twitter/X tweet metrics (public_metrics: like_count, retweet_count, reply_count, impression_count)
 * Uses GET /2/tweets/:id with tweet.fields=public_metrics.
 */
async function fetchTwitterAnalytics(tweetId, integration) {
  const opts = {};
  if (integration.accessTokenSecret && integration.twitterOAuth1AccessToken) {
    opts.accessTokenSecret = integration.accessTokenSecret;
    opts.oauth1AccessToken = integration.twitterOAuth1AccessToken;
  }
  const data = await getTweetWithMetrics(tweetId, integration.accessToken, opts);
  if (!data?.data) return null;
  const m = data.data.public_metrics || {};
  return {
    impressions: m.impression_count ?? 0,
    likes: m.like_count ?? 0,
    retweets: m.retweet_count ?? 0,
    replies: m.reply_count ?? 0,
    comments: m.reply_count ?? 0,
  };
}

/**
 * Fetch Threads media analytics.
 *
 * Strategy:
 *  1. Basic media fields (like_count, reply_count) — threads_basic scope.
 *  2. Insights (views, reposts, quotes) — requires threads_manage_insights.
 */
async function fetchThreadsAnalytics(mediaId, accessToken) {
  const THREADS = 'https://graph.threads.net/v1.0';
  const result = {};

  // ── Step 1: Validate media ID exists (no engagement fields on media object) ─
  // Threads API does NOT expose like_count/reply_count on the media node.
  // Only use safe metadata fields that are always available.
  try {
    const { data: mediaData } = await axios.get(`${THREADS}/${mediaId}`, {
      params: {
        fields: 'id,media_type,timestamp',
        access_token: accessToken,
      },
    });
    if (!mediaData?.id) return null; // media not found
    if (mediaData.media_type) result.mediaType = mediaData.media_type;
  } catch (basicErr) {
    const msg = basicErr.response?.data?.error?.message || basicErr.message;
    console.warn('[analytics] Threads media lookup failed:', msg);
    return null; // media ID invalid or no permission
  }

  // ── Step 2: Insights — all engagement data lives here ────────────────────
  // Requires threads_manage_insights. Gracefully skip if permission is missing.
  try {
    const { data: insightsData } = await axios.get(`${THREADS}/${mediaId}/insights`, {
      params: {
        metric: 'views,likes,replies,reposts,quotes',
        access_token: accessToken,
      },
    });
    const metrics = (insightsData.data || []).reduce((acc, m) => {
      const val = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
      acc[m.name] = typeof val === 'number' ? val : 0;
      return acc;
    }, {});
    if (metrics.views != null) { result.views = metrics.views; result.impressions = metrics.views; }
    if (metrics.likes != null) result.likes = metrics.likes;
    if (metrics.replies != null) { result.replies = metrics.replies; result.comments = metrics.replies; }
    if (metrics.reposts != null) result.reposts = metrics.reposts;
    if (metrics.quotes != null) result.quotes = metrics.quotes;
  } catch (insightsErr) {
    const status = insightsErr.response?.status;
    const msg = insightsErr.response?.data?.error?.message || insightsErr.message;
    // 4 = Application does not have permission, 10 = no access, 100 = bad param, 403/500 = permission
    const isPermissionErr = status === 403 || status === 500 ||
      (insightsErr.response?.data?.error?.code && [4, 10, 100, 200, 803].includes(insightsErr.response?.data?.error?.code));
    if (!isPermissionErr) {
      console.warn('[analytics] Threads insights (optional):', msg);
    }
    // Return whatever we have (even if just mediaType) — not null
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Fetch and cache analytics for a single post.
 * @param {object} post - Post object with platformIds
 * @param {string} userId
 * @param {Array} [clientIntegrations] - Optional pre-loaded integrations (avoids server Firestore)
 */
export async function fetchPostAnalytics(post, userId, clientIntegrations = null) {
  const platformIds = post.platformIds instanceof Map ? Object.fromEntries(post.platformIds) : (post.platformIds || {});
  const analytics = {};
  let integrations;
  try {
    integrations = clientIntegrations?.length
      ? clientIntegrations
      : await integrationRepo.find({ userId, isActive: true });
  } catch (_) {
    integrations = clientIntegrations || [];
  }

  for (const platform of ['linkedin', 'instagram', 'facebook', 'twitter', 'threads']) {
    const platformPostId = platformIds[platform];
    if (!platformPostId) continue;

    const int = integrations.find((i) => i.platform === platform);
    if (!int?.accessToken) {
      console.log('[analytics] No integration for', platform, 'post', post._id);
      continue;
    }

    let data = null;
    try {
      if (platform === 'linkedin') {
        data = await fetchLinkedInAnalytics(platformPostId, int.accessToken);
      } else if (platform === 'instagram') {
        const token = int.instagramPageAccessToken || int.accessToken;
        const useFacebookHost = !!int.instagramPageAccessToken;
        data = await fetchInstagramAnalytics(platformPostId, token, useFacebookHost);
      } else if (platform === 'facebook') {
        const token = int.facebookPageAccessToken || int.accessToken;
        data = await fetchFacebookAnalytics(platformPostId, token);
      } else if (platform === 'twitter') {
        data = await fetchTwitterAnalytics(platformPostId, int);
      } else if (platform === 'threads') {
        data = await fetchThreadsAnalytics(platformPostId, int.accessToken);
      }
      console.log(`[analytics] ${platform} post ${String(post._id || post.id).slice(0, 8)}: ${data ? JSON.stringify(data) : 'null (no data)'}`);
    } catch (platformErr) {
      console.warn('[analytics]', platform, 'fetch error for post', post._id, ':', platformErr.response?.data || platformErr.message);
    }
    if (data) analytics[platform] = data;
  }

  if (Object.keys(analytics).length > 0) {
    // Best-effort persist to server Firestore; credential errors are silently ignored
    try {
      await postRepo.findByIdAndUpdate(post._id, {
        analytics,
        analyticsFetchedAt: new Date(),
      });
    } catch (_) {}
  }

  // Always return analytics (+ postId so callers can build a lookup map)
  return { postId: String(post._id || post.id || ''), analytics };
}

/**
 * Get analytics for report chart - aggregate by date with per-platform metrics
 * Returns { chartData: [...], platforms: { linkedin: {...}, ... } }
 */
export async function getReportChartData(userId, fromDate, toDate) {
  const query = { userId, status: 'published' };
  if (fromDate || toDate) {
    query.publishedAt = {};
    if (fromDate) query.publishedAt.$gte = new Date(fromDate);
    if (toDate) query.publishedAt.$lte = new Date(toDate + 'T23:59:59.999Z');
  }

  const posts = await postRepo.find(query, { limit: 500 });
  const withAnalytics = posts.filter((p) => {
    const a = p.analytics instanceof Map ? Object.fromEntries(p.analytics) : (p.analytics || {});
    return Object.keys(a).length > 0;
  }).length;
  if (posts.length === 0) {
    const totalPublished = await postRepo.countDocuments({ userId, status: 'published' });
    console.log('[analytics] getReportChartData', { userId, postCount: 0, totalPublished, fromDate, toDate });
  } else {
    console.log('[analytics] getReportChartData', { userId, postCount: posts.length, withAnalytics });
  }
  const byDate = {};

  for (const post of posts) {
    const pubDate = post.publishedAt || post.createdAt;
    if (!pubDate) continue;

    const dateStr = new Date(pubDate).toISOString().slice(0, 10);
    const analytics = post.analytics instanceof Map ? Object.fromEntries(post.analytics) : (post.analytics || {});

    if (!byDate[dateStr]) {
      byDate[dateStr] = {
        date: dateStr,
        linkedin: { impressions: 0, likes: 0, comments: 0 },
        instagram: { impressions: 0, likes: 0, comments: 0, engagement: 0 },
        twitter: { impressions: 0, likes: 0, retweets: 0, replies: 0 },
        facebook: { impressions: 0, engagedUsers: 0, reactions: 0 },
        threads: { views: 0, likes: 0, replies: 0, reposts: 0 },
      };
    }
    const d = byDate[dateStr];
    if (analytics.linkedin) {
      d.linkedin.impressions += analytics.linkedin.impressions || 0;
      d.linkedin.likes += analytics.linkedin.likes || 0;
      d.linkedin.comments += analytics.linkedin.comments || 0;
    }
    if (analytics.instagram) {
      d.instagram.impressions += analytics.instagram.impressions || 0;
      d.instagram.likes += Number(analytics.instagram.likes ?? analytics.instagram.engagement ?? 0);
      d.instagram.comments += analytics.instagram.comments || 0;
      d.instagram.engagement += (analytics.instagram.engagement || 0);
    }
    if (analytics.twitter) {
      d.twitter.impressions += analytics.twitter.impressions || 0;
      d.twitter.likes += analytics.twitter.likes || 0;
      d.twitter.retweets += analytics.twitter.retweets || 0;
      d.twitter.replies += analytics.twitter.replies || 0;
    }
    if (analytics.facebook) {
      d.facebook.impressions += analytics.facebook.impressions || 0;
      d.facebook.engagedUsers += analytics.facebook.engagedUsers || 0;
      d.facebook.reactions += analytics.facebook.reactions || 0;
    }
    if (analytics.threads) {
      d.threads.views += analytics.threads.views || analytics.threads.impressions || 0;
      d.threads.likes += analytics.threads.likes || 0;
      d.threads.replies += analytics.threads.replies || 0;
      d.threads.reposts += analytics.threads.reposts || 0;
    }
  }

  const chartData = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

  // Flatten for backward compatibility and add legacy keys
  const flatData = chartData.map((d) => ({
    ...d,
    linkedin_impressions: d.linkedin.impressions,
    linkedin_likes: d.linkedin.likes,
    linkedin_comments: d.linkedin.comments,
    instagram_impressions: d.instagram.impressions,
    instagram_likes: d.instagram.likes,
    instagram_comments: d.instagram.comments,
    twitter_impressions: d.twitter.impressions,
    twitter_likes: d.twitter.likes,
    twitter_retweets: d.twitter.retweets,
    twitter_replies: d.twitter.replies,
    facebook_impressions: d.facebook.impressions,
    facebook_engagedUsers: d.facebook.engagedUsers,
    facebook_reactions: d.facebook.reactions,
    threads_views: d.threads.views,
    threads_impressions: d.threads.views,
    threads_likes: d.threads.likes,
    threads_replies: d.threads.replies,
    threads_reposts: d.threads.reposts,
  }));

  return flatData;
}

/**
 * Get post history with analytics for report page
 */
export async function getReportPosts(userId, fromDate, toDate) {
  const query = { userId, status: 'published' };
  if (fromDate || toDate) {
    query.publishedAt = {};
    if (fromDate) query.publishedAt.$gte = new Date(fromDate);
    if (toDate) query.publishedAt.$lte = new Date(toDate + 'T23:59:59.999Z');
  }

  const posts = await postRepo.find(query, { limit: 500 });
  return posts.map((p) => {
    const analytics = p.analytics instanceof Map ? Object.fromEntries(p.analytics) : (p.analytics || {});
    const platformIds = p.platformIds instanceof Map ? Object.fromEntries(p.platformIds) : (p.platformIds || {});
    const platformUrls = p.platformUrls instanceof Map ? Object.fromEntries(p.platformUrls) : (p.platformUrls || {});
    return {
      id: p._id,
      content: (p.content || '').slice(0, 200),
      publishedAt: p.publishedAt || p.createdAt,
      platforms: p.platforms || [],
      platformIds,
      platformUrls,
      analytics,
    };
  });
}
