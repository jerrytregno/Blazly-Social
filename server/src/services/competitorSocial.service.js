import { fetchHtml } from './scraper.service.js';
import * as cheerio from 'cheerio';
import { analyzeCompetitorSocialFromData } from './gemini.js';

const PLATFORMS = ['linkedin', 'instagram', 'facebook', 'twitter'];

/**
 * Extract activity indicators from a social profile page
 * @param {string} url - Profile URL
 * @param {string} platform - linkedin, instagram, facebook, twitter
 * @returns {Promise<{ platform, url, followers?: number, posts?: number, indicators?: object, error?: string }>}
 */
async function scrapeSocialProfile(url, platform) {
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const result = { platform, url, indicators: {} };

    // Extract from meta tags (og:*, twitter:*) or common patterns
    const metaFollowers = $('meta[property="og:description"]').attr('content')
      || $('meta[name="description"]').attr('content')
      || '';
    const numMatch = metaFollowers.match(/([\d,.\s]+(?:K|M|k|m)?)\s*(?:followers|fans|likes|connections)/i)
      || metaFollowers.match(/(?:followers|fans|likes)[:\s]*([\d,.\s]+(?:K|M|k|m)?)/i);
    if (numMatch) {
      let n = numMatch[1].replace(/,|\s/g, '').toLowerCase();
      const mult = n.endsWith('k') ? 1000 : n.endsWith('m') ? 1000000 : 1;
      n = parseFloat(n) || 0;
      result.indicators.followers = Math.round(n * mult);
    }

    // Try to find post count in page text
    const bodyText = $('body').text();
    const postMatch = bodyText.match(/([\d,]+)\s*posts?/i) || bodyText.match(/posts?[:\s]*([\d,]+)/i);
    if (postMatch) {
      result.indicators.posts = parseInt(postMatch[1].replace(/,/g, ''), 10) || undefined;
    }

    return result;
  } catch (err) {
    return { platform, url, error: err.message };
  }
}

/**
 * Analyze competitor social links and generate activity report
 * @param {string} userId
 * @param {string} competitorName
 * @param {object} socialLinks - { linkedin, instagram, facebook, twitter } -> URL
 * @returns {Promise<{ summary, postFrequency, engagementLevel, platformActivity }>}
 */
export async function analyzeCompetitorSocialActivity(userId, competitorName, socialLinks) {
  if (!socialLinks || typeof socialLinks !== 'object') {
    return null;
  }

  const platformData = {};
  const promises = [];

  for (const platform of PLATFORMS) {
    const url = socialLinks[platform] || socialLinks[platform.toLowerCase()];
    if (url && (url.startsWith('http') || url.startsWith('linkedin.com') || url.startsWith('instagram.com'))) {
      const fullUrl = url.startsWith('http') ? url : `https://www.${url}`;
      promises.push(scrapeSocialProfile(fullUrl, platform).then((r) => r));
    }
  }

  const results = await Promise.all(promises);

  for (const r of results) {
    if (r.platform) {
      platformData[r.platform] = {
        url: r.url,
        ...r.indicators,
        error: r.error,
      };
    }
  }

  if (Object.keys(platformData).length === 0) {
    return null;
  }

  const aiReport = await analyzeCompetitorSocialFromData(
    competitorName,
    platformData,
  );

  return {
    summary: aiReport?.summary || 'Social activity data collected.',
    postFrequency: aiReport?.postFrequency || 'Unknown',
    engagementLevel: aiReport?.engagementLevel || 'Unknown',
    platformActivity: platformData,
    lastAnalyzedAt: new Date(),
  };
}
