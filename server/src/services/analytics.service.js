import axios from 'axios';
import * as integrationRepo from '../db/repositories/integrationRepository.js';
import * as postRepo from '../db/postRepository.js';
import { getTweetWithMetrics } from './twitter.js';

/**
 * Fetch LinkedIn post analytics (impressions, engagement)
 * Note: organizationalEntityShareStatistics is for org shares. Member posts may need r_member_postAnalytics.
 */
async function fetchLinkedInAnalytics(postId, accessToken) {
  try {
    const urn = postId.startsWith('urn:') ? postId : `urn:li:share:${postId}`;
    const { data } = await axios.get(
      'https://api.linkedin.com/rest/organizationalEntityShareStatistics',
      {
        params: { q: 'organizationalEntity', 'shares[0]': urn },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'LinkedIn-Version': '202506',
          'X-Restli-Protocol-Version': '2.0.0',
        },
      }
    );
    const el = data.elements?.[0];
    if (!el) return null;
    const stats = el.totalShareStatistics || {};
    return {
      impressions: el.organicImpressionsCount ?? stats.impressionCount ?? 0,
      likes: stats.likeCount ?? 0,
      comments: stats.commentCount ?? 0,
    };
  } catch (err) {
    if (err.response?.status === 403 || err.response?.status === 404) return null;
    console.warn('LinkedIn analytics fetch:', err.response?.data?.message || err.message);
    return null;
  }
}

/**
 * Fetch Instagram media insights (likes, comments, impressions, reach)
 * Uses insights endpoint - likes/comments are available for FEED and REELS.
 * Fallback: try engagement,impressions,reach if likes/comments fail (e.g. STORY).
 * @param {boolean} useFacebookHost - Use graph.facebook.com for Page tokens
 */
async function fetchInstagramAnalytics(mediaId, accessToken, useFacebookHost = false) {
  const baseUrl = useFacebookHost ? 'https://graph.facebook.com/v18.0' : 'https://graph.instagram.com/v18.0';
  try {
    // Request likes, comments, impressions, reach - available for FEED posts and REELS
    const metricsToRequest = 'likes,comments,impressions,reach,engagement';
    const { data: insightsData } = await axios.get(
      `${baseUrl}/${mediaId}/insights`,
      {
        params: {
          metric: metricsToRequest,
          period: 'lifetime',
          access_token: accessToken,
        },
      }
    );
    const metrics = (insightsData?.data || []).reduce((acc, m) => {
      const val = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
      acc[m.name] = typeof val === 'number' ? val : 0;
      return acc;
    }, {});
    return {
      impressions: metrics.impressions || 0,
      reach: metrics.reach || 0,
      engagement: metrics.engagement || 0,
      likes: metrics.likes ?? metrics.engagement ?? 0,
      comments: metrics.comments ?? 0,
    };
  } catch (err) {
    const errMsg = err.response?.data?.error?.message || err.message;
    const errCode = err.response?.data?.error?.code;
    // Try fallback with fewer metrics (e.g. for STORY or older API)
    if (err.response?.status === 400 || errCode === 100) {
      try {
        const { data: fallbackData } = await axios.get(
          `${baseUrl}/${mediaId}/insights`,
          {
            params: {
              metric: 'engagement,impressions,reach',
              period: 'lifetime',
              access_token: accessToken,
            },
          }
        );
        const m = (fallbackData?.data || []).reduce((acc, x) => {
          acc[x.name] = x.values?.[0]?.value ?? x.total_value?.value ?? 0;
          return acc;
        }, {});
        return {
          impressions: m.impressions || 0,
          reach: m.reach || 0,
          engagement: m.engagement || 0,
          likes: m.engagement || 0,
          comments: 0,
        };
      } catch (fallbackErr) {
        console.warn('[analytics] Instagram fetch:', errMsg, 'fallback:', fallbackErr.response?.data?.error?.message);
        return null;
      }
    }
    console.warn('[analytics] Instagram fetch:', errMsg);
    return null;
  }
}

/**
 * Fetch Facebook post insights (impressions, engagement, reactions, clicks)
 */
async function fetchFacebookAnalytics(postId, pageAccessToken) {
  try {
    const { data } = await axios.get(
      `https://graph.facebook.com/v18.0/${postId}/insights`,
      {
        params: {
          metric: 'post_impressions,post_impressions_unique,post_engaged_users,post_reactions_by_type_total,post_clicks',
          access_token: pageAccessToken,
        },
      }
    );
    const metrics = (data.data || []).reduce((acc, m) => {
      const val = m.values?.[0];
      if (typeof val?.value === 'number') acc[m.name] = val.value;
      else if (val?.value && typeof val.value === 'object') acc[m.name] = Object.values(val.value).reduce((s, v) => s + (Number(v) || 0), 0);
      return acc;
    }, {});
    const reactionsTotal = metrics.post_reactions_by_type_total ?? 0;
    return {
      impressions: metrics.post_impressions ?? metrics.post_impressions_unique ?? 0,
      impressionsUnique: metrics.post_impressions_unique ?? 0,
      engagedUsers: metrics.post_engaged_users ?? 0,
      reactions: reactionsTotal,
      likes: reactionsTotal,
      clicks: metrics.post_clicks ?? 0,
    };
  } catch (err) {
    if (err.response?.status === 400) return null;
    console.warn('Facebook analytics fetch:', err.response?.data?.error?.message || err.message);
    return null;
  }
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
 * Fetch Threads media insights (views, likes, replies, reposts, quotes)
 * Requires threads_manage_insights permission.
 */
async function fetchThreadsAnalytics(mediaId, accessToken) {
  try {
    const { data } = await axios.get(
      `https://graph.threads.net/v1.0/${mediaId}/insights`,
      {
        params: {
          metric: 'views,likes,replies,reposts,quotes',
          access_token: accessToken,
        },
      }
    );
    const metrics = (data.data || []).reduce((acc, m) => {
      const val = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
      acc[m.name] = typeof val === 'number' ? val : 0;
      return acc;
    }, {});
    return {
      views: metrics.views || 0,
      impressions: metrics.views || 0,
      likes: metrics.likes || 0,
      replies: metrics.replies || 0,
      comments: metrics.replies || 0,
      reposts: metrics.reposts || 0,
      quotes: metrics.quotes || 0,
    };
  } catch (err) {
    if (err.response?.status === 400 || err.response?.status === 403) return null;
    console.warn('Threads analytics fetch:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

/**
 * Fetch and cache analytics for a single post
 */
export async function fetchPostAnalytics(post, userId) {
  const platformIds = post.platformIds instanceof Map ? Object.fromEntries(post.platformIds) : (post.platformIds || {});
  const analytics = {};
  const integrations = await integrationRepo.find({ userId, isActive: true });

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
      const useFacebookHost = !!int.instagramPageAccessToken; // Page token works with graph.facebook.com
      data = await fetchInstagramAnalytics(platformPostId, token, useFacebookHost);
    } else if (platform === 'facebook') {
      const token = int.facebookPageAccessToken || int.accessToken;
      data = await fetchFacebookAnalytics(platformPostId, token);
    } else if (platform === 'twitter') {
      data = await fetchTwitterAnalytics(platformPostId, int);
    } else if (platform === 'threads') {
      data = await fetchThreadsAnalytics(platformPostId, int.accessToken);
    }
    } catch (platformErr) {
      console.warn('[analytics]', platform, 'fetch error for post', post._id, ':', platformErr.response?.data || platformErr.message);
    }
    if (data) analytics[platform] = data;
  }

  if (Object.keys(analytics).length > 0) {
    await postRepo.findByIdAndUpdate(post._id, {
      analytics,
      analyticsFetchedAt: new Date(),
    });
  }

  return analytics;
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
