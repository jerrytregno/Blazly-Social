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
        const existing = await keywordMatchRepo.findOne({
          userId,
          platform: 'linkedin',
          postId: adId,
        });
        if (existing) continue;

        const advertiser = el.details?.advertiser?.advertiserName || 'Unknown';
        await keywordMatchRepo.create({
          userId,
          keyword: q,
          platform: 'linkedin',
          postId: adId,
          postUrl: el.adUrl || `https://www.linkedin.com/ad-library/detail/${adId}`,
          postText: el.details?.advertiser?.advertiserName ? `Ad by ${advertiser}` : null,
          authorUsername: advertiser,
          authorName: advertiser,
        });
        matches.push({ keyword: q, platform: 'linkedin', postId: adId });
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
        const existing = await keywordMatchRepo.findOne({
          userId,
          platform: 'twitter',
          postId: t.id,
        });
        if (existing) continue;

        await keywordMatchRepo.create({
          userId,
          keyword: q,
          platform: 'twitter',
          postId: t.id,
          postUrl: `https://x.com/i/status/${t.id}`,
          postText: t.text?.slice(0, 500),
          authorUsername: author?.username,
          authorName: author?.name,
        });
        matches.push({ keyword: q, platform: 'twitter', postId: t.id });
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

/**
 * Run keyword polling for a user across all platforms
 */
export async function runKeywordPoll(userId) {
  const poll = await keywordPollRepo.findOne({ userId });
  if (!poll?.enabled) return { matched: 0, message: 'Keyword poll not enabled' };
  if (!poll?.keywords?.length) return { matched: 0, message: 'No keywords configured' };

  const platforms = poll.platforms?.length ? poll.platforms : ['twitter', 'linkedin'];
  console.log('[Keyword poll] Run for user', userId, 'platforms:', platforms.join(','), 'keywords:', poll.keywords?.length);
  let totalMatched = 0;

  if (platforms.includes('twitter')) {
    const integration = await integrationRepo.findOne({ userId, platform: 'twitter', isActive: true });
    if (integration) {
      const m = await pollTwitterForKeywords(userId, poll.keywords, integration);
      totalMatched += m.length;
    }
  }

  if (platforms.includes('linkedin')) {
    const integration = await integrationRepo.findOne({ userId, platform: 'linkedin', isActive: true });
    if (integration) {
      const m = await pollLinkedInAdLibrary(userId, poll.keywords, integration);
      totalMatched += m.length;
    }
  }

  await keywordPollRepo.findByIdAndUpdate(poll._id, { lastPolledAt: new Date() });
  return { matched: totalMatched };
}
