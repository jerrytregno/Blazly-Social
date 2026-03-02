import { fetchHtml } from './scraper.service.js';
import * as cheerio from 'cheerio';
import { analyzeCompetitorSocialFromData } from './gemini.js';

const PLATFORMS = ['linkedin', 'instagram', 'facebook', 'twitter', 'threads'];

/** Parse a social count string like "12.3K", "1.5M", "234" into a number */
function parseSocialCount(str) {
  if (!str) return null;
  const s = str.replace(/,/g, '').trim();
  const m = s.match(/^([\d.]+)\s*([KkMmBb]?)$/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const mult = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9 }[m[2]] || 1;
  return Math.round(num * mult);
}

/**
 * Extract rich activity data from a social profile page.
 * Pulls OG tags, Twitter card tags, JSON-LD, and visible engagement signals.
 */
async function scrapeSocialProfile(url, platform) {
  const result = { platform, url, indicators: {}, rawSignals: [] };
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    // ---- 1. All OG & meta tags ----
    const ogTitle = $('meta[property="og:title"]').attr('content') || $('title').text() || '';
    const ogDesc = $('meta[property="og:description"]').attr('content') || '';
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const twitterDesc = $('meta[name="twitter:description"]').attr('content') || '';
    const twitterTitle = $('meta[name="twitter:title"]').attr('content') || '';
    const ogSiteName = $('meta[property="og:site_name"]').attr('content') || '';
    const canonicalUrl = $('link[rel="canonical"]').attr('href') || url;

    result.title = ogTitle || twitterTitle;
    result.description = ogDesc || metaDesc || twitterDesc;
    result.indicators.siteName = ogSiteName;

    // ---- 2. JSON-LD structured data ----
    const jsonLdData = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const parsed = JSON.parse($(el).html() || '{}');
        jsonLdData.push(parsed);
      } catch (_) {}
    });
    if (jsonLdData.length > 0) result.indicators.structuredData = jsonLdData;

    // ---- 3. Visible page text for engagement signals ----
    const bodyText = $('body').text().replace(/\s+/g, ' ');
    result.rawSignals.push(bodyText.slice(0, 3000)); // first 3000 chars of visible text

    // ---- 4. Platform-specific extraction ----
    const allText = [ogDesc, metaDesc, twitterDesc, bodyText.slice(0, 5000)].join(' ');

    // Followers count patterns
    const followerPatterns = [
      /([\d,.]+[KkMmBb]?)\s*(?:Followers|followers|FOLLOWERS|fans|Fans)/,
      /(?:Followers|followers|fans)[:\s]*([\d,.]+[KkMmBb]?)/,
      /([\d,.]+[KkMmBb]?)\s*(?:connections|Connections)/,
      /(?:connections)[:\s]*([\d,.]+[KkMmBb]?)/,
    ];
    for (const pat of followerPatterns) {
      const m = allText.match(pat);
      if (m) {
        const count = parseSocialCount(m[1]);
        if (count) { result.indicators.followers = count; break; }
      }
    }

    // Following count patterns
    const followingMatch = allText.match(/([\d,.]+[KkMmBb]?)\s*(?:Following|following)/)
      || allText.match(/(?:Following|following)[:\s]*([\d,.]+[KkMmBb]?)/);
    if (followingMatch) {
      const count = parseSocialCount(followingMatch[1]);
      if (count) result.indicators.following = count;
    }

    // Posts/content count
    const postPatterns = [
      /([\d,]+)\s*(?:posts?|Posts?|POSTS?)/,
      /(?:posts?|Posts?)[:\s]*([\d,]+)/,
      /([\d,]+)\s*(?:tweets?|Tweets?)/,
      /([\d,]+)\s*(?:videos?|Videos?)/,
    ];
    for (const pat of postPatterns) {
      const m = allText.match(pat);
      if (m) {
        const count = parseInt(m[1].replace(/,/g, ''), 10);
        if (count > 0) { result.indicators.postsCount = count; break; }
      }
    }

    // Engagement signals (likes, comments seen on page)
    const likeMatch = allText.match(/([\d,.]+[KkMm]?)\s*(?:Likes?|likes?|reactions?|Reactions?)/);
    if (likeMatch) {
      const count = parseSocialCount(likeMatch[1]);
      if (count) result.indicators.likes = count;
    }
    const commentMatch = allText.match(/([\d,.]+[KkMm]?)\s*(?:comments?|Comments?)/);
    if (commentMatch) {
      const count = parseSocialCount(commentMatch[1]);
      if (count) result.indicators.comments = count;
    }

    // Platform-specific: Instagram format "123 Followers · 456 Following · 789 Posts"
    if (platform === 'instagram' || platform === 'threads') {
      const igMatch = allText.match(/([\d,.]+[KkMm]?)\s*Followers?\s*[·,]\s*([\d,.]+[KkMm]?)\s*Following\s*[·,]\s*([\d,.]+[KkMm]?)\s*Posts?/i);
      if (igMatch) {
        result.indicators.followers = parseSocialCount(igMatch[1]) || result.indicators.followers;
        result.indicators.following = parseSocialCount(igMatch[2]) || result.indicators.following;
        result.indicators.postsCount = parseSocialCount(igMatch[3]) || result.indicators.postsCount;
      }
    }

    // LinkedIn: "X followers | Y connections" in meta description
    if (platform === 'linkedin') {
      const liMatch = allText.match(/([\d,]+)\s*followers?\s*(?:on LinkedIn|·|and)/i);
      if (liMatch) result.indicators.followers = parseSocialCount(liMatch[1]) || result.indicators.followers;
    }

    // Extract any visible post text snippets (for content analysis)
    const articleTexts = [];
    $('article, [role="article"], .post, .tweet, .entry, main p').each((_, el) => {
      const t = $(el).text().trim();
      if (t.length > 50 && t.length < 500) articleTexts.push(t);
    });
    if (articleTexts.length > 0) result.indicators.sampleContent = articleTexts.slice(0, 5);

    // Last post date signals
    const datePatterns = /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4}|\d{4}-\d{2}-\d{2})/g;
    const dates = bodyText.match(datePatterns);
    if (dates?.length) result.indicators.visibleDates = [...new Set(dates)].slice(0, 5);

  } catch (err) {
    result.error = err.message;
  }
  return result;
}

/**
 * Analyze competitor social links and generate a detailed activity report.
 * @param {string} userId
 * @param {string} competitorName
 * @param {object} socialLinks - { linkedin, instagram, facebook, twitter } -> URL
 * @returns {Promise<object>} Detailed social activity report
 */
export async function analyzeCompetitorSocialActivity(userId, competitorName, socialLinks) {
  if (!socialLinks || typeof socialLinks !== 'object') return null;

  const promises = [];
  for (const platform of PLATFORMS) {
    const url = socialLinks[platform] || socialLinks[platform.toLowerCase()];
    if (url) {
      const fullUrl = url.startsWith('http') ? url : `https://www.${url}`;
      promises.push(scrapeSocialProfile(fullUrl, platform));
    }
  }

  const results = await Promise.allSettled(promises);
  const platformData = {};

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value?.platform) {
      const { platform, url, title, description, indicators, rawSignals, error } = r.value;
      platformData[platform] = {
        url,
        title,
        description,
        ...indicators,
        rawSnippet: rawSignals?.[0]?.slice(0, 1500) || '',
        error: error || null,
      };
    }
  }

  if (Object.keys(platformData).length === 0) return null;

  const aiReport = await analyzeCompetitorSocialFromData(competitorName, platformData);

  return {
    summary: aiReport?.summary || 'Social activity data collected.',
    postFrequency: aiReport?.postFrequency || 'Unknown',
    engagementLevel: aiReport?.engagementLevel || 'Unknown',
    bestPostingTimes: aiReport?.bestPostingTimes || [],
    contentThemes: aiReport?.contentThemes || [],
    audienceInsights: aiReport?.audienceInsights || '',
    platformBreakdown: aiReport?.platformBreakdown || {},
    ideaGenerationHints: aiReport?.ideaGenerationHints || [],
    platformActivity: platformData,
    lastAnalyzedAt: new Date().toISOString(),
  };
}
