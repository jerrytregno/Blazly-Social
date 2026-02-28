import axios from 'axios';
import * as integrationRepo from '../db/repositories/integrationRepository.js';
import { getPersonalizedTrends } from './twitter.js';

const GRAPH_BASE = 'https://graph.facebook.com/v18.0';

/**
 * Fetch Twitter/X personalized trends
 */
async function fetchTwitterTrends(integration) {
  const opts = {};
  if (integration.accessTokenSecret && integration.twitterOAuth1AccessToken) {
    opts.accessTokenSecret = integration.accessTokenSecret;
    opts.oauth1AccessToken = integration.twitterOAuth1AccessToken;
  }
  const data = await getPersonalizedTrends(integration.accessToken, opts);
  if (!data?.data) return null;
  return data.data.map((t) => ({
    trend_name: t.trend_name,
    category: t.category,
    post_count: t.post_count,
    trending_since: t.trending_since,
  }));
}

/**
 * Fetch Instagram hashtag trends (top hashtags by recent media count)
 * Uses hashtag search - limited to 30 unique hashtags per 7 days.
 */
async function fetchInstagramTrends(integration) {
  if (!integration.instagramBusinessAccountId && !integration.platformUserId) return null;
  const igUserId = integration.instagramBusinessAccountId || integration.platformUserId;
  const token = integration.instagramPageAccessToken || integration.accessToken;
  if (!token) return null;

  const POPULAR_HASHTAGS = ['marketing', 'business', 'entrepreneur', 'socialmedia', 'content', 'tech', 'innovation'];
  const trends = [];

  for (const tag of POPULAR_HASHTAGS.slice(0, 5)) {
    try {
      const { data: searchData } = await axios.get(`${GRAPH_BASE}/ig_hashtag_search`, {
        params: { user_id: igUserId, q: tag, access_token: token },
      });
      const hashtagId = searchData?.data?.[0]?.id;
      if (!hashtagId) continue;

      const { data: mediaData } = await axios.get(`${GRAPH_BASE}/${hashtagId}/recent_media`, {
        params: {
          user_id: igUserId,
          fields: 'id',
          limit: 10,
          access_token: token,
        },
      });
      const media = mediaData?.data || [];
      trends.push({
        trend_name: `#${tag}`,
        category: 'hashtag',
        post_count: media.length,
      });
    } catch (err) {
      if (err.response?.status === 400 || err.response?.status === 403) break;
    }
  }

  return trends.length ? trends : null;
}

/**
 * LinkedIn, Facebook, Threads: No public trending API.
 * Return curated fallback based on common industry topics.
 */
function getFallbackTrends(platform) {
  const FALLBACK = {
    linkedin: [
      { trend_name: 'AI in business', category: 'business', post_count: null, note: 'Based on platform engagement' },
      { trend_name: 'Remote work', category: 'professional', post_count: null, note: 'Based on platform engagement' },
      { trend_name: 'Thought leadership', category: 'content', post_count: null, note: 'Based on platform engagement' },
      { trend_name: 'Sustainability', category: 'business', post_count: null, note: 'Based on platform engagement' },
      { trend_name: 'Personal branding', category: 'career', post_count: null, note: 'Based on platform engagement' },
    ],
    facebook: [
      { trend_name: 'Community engagement', category: 'social', post_count: null, note: 'Based on platform engagement' },
      { trend_name: 'Video content', category: 'content', post_count: null, note: 'Based on platform engagement' },
      { trend_name: 'Local business', category: 'business', post_count: null, note: 'Based on platform engagement' },
      { trend_name: 'Events', category: 'social', post_count: null, note: 'Based on platform engagement' },
      { trend_name: 'Reels', category: 'content', post_count: null, note: 'Based on platform engagement' },
    ],
    threads: [
      { trend_name: 'Conversational content', category: 'social', post_count: null, note: 'Based on platform engagement' },
      { trend_name: 'Casual updates', category: 'content', post_count: null, note: 'Based on platform engagement' },
      { trend_name: 'Community threads', category: 'social', post_count: null, note: 'Based on platform engagement' },
      { trend_name: 'Real-time discussions', category: 'engagement', post_count: null, note: 'Based on platform engagement' },
      { trend_name: 'Short-form updates', category: 'content', post_count: null, note: 'Based on platform engagement' },
    ],
  };
  return FALLBACK[platform] || [];
}

/**
 * Fetch platform trends for a user (all platforms: Twitter, LinkedIn, Facebook, Instagram, Threads)
 */
export async function fetchPlatformTrends(userId) {
  const integrations = await integrationRepo.find({ userId, isActive: true });
  const byPlatform = Object.fromEntries(integrations.map((i) => [i.platform, i]));

  const result = {};

  const twitterInt = byPlatform.twitter;
  if (twitterInt) {
    const trends = await fetchTwitterTrends(twitterInt);
    result.twitter = trends ? { data: trends, source: 'api' } : { data: getFallbackTrends('linkedin'), source: 'fallback', note: 'API unavailable' };
  } else {
    result.twitter = { data: getFallbackTrends('linkedin'), source: 'fallback', note: 'Connect X for personalized trends' };
  }

  const instagramInt = byPlatform.instagram;
  if (instagramInt) {
    const trends = await fetchInstagramTrends(instagramInt);
    result.instagram = trends ? { data: trends, source: 'api' } : { data: getFallbackTrends('facebook'), source: 'fallback', note: 'Connect Instagram for hashtag trends' };
  } else {
    result.instagram = { data: getFallbackTrends('facebook'), source: 'fallback', note: 'Connect Instagram for hashtag trends' };
  }

  result.linkedin = { data: getFallbackTrends('linkedin'), source: 'fallback', note: 'No public trending API' };
  result.facebook = { data: getFallbackTrends('facebook'), source: 'fallback', note: 'No public trending API' };
  result.threads = { data: getFallbackTrends('threads'), source: 'fallback', note: 'No public trending API' };

  return result;
}
