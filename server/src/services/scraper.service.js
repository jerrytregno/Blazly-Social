import axios from 'axios';
import * as cheerio from 'cheerio';

const BOT_UA = 'Mozilla/5.0 (compatible; BlazlyBot/1.0; +https://blazly.app)';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Fetch HTML from URL with timeout and user-agent.
 * Retries with a browser UA if bot UA is blocked (403/429).
 */
export async function fetchHtml(url) {
  const normalized = url.startsWith('http') ? url : `https://${url}`;
  for (const ua of [BOT_UA, BROWSER_UA]) {
    try {
      const { data } = await axios.get(normalized, {
        timeout: 20000,
        headers: { 'User-Agent': ua },
        maxRedirects: 5,
      });
      return data;
    } catch (err) {
      const status = err.response?.status;
      if ((status === 403 || status === 429) && ua === BOT_UA) continue; // retry with browser UA
      if (status === 403) throw new Error('This website blocks automated access. Try a different URL or skip this step.');
      if (status === 404) throw new Error('Website not found (404). Check the URL and try again.');
      if (status === 429) throw new Error('Website is rate-limiting requests. Please try again in a moment.');
      throw err;
    }
  }
}

/**
 * Attempt to fetch and parse a sitemap (sitemap.xml or sitemap_index.xml).
 * Returns an array of up to `limit` page URLs found in the sitemap, or [] if none.
 */
export async function fetchSitemapUrls(baseUrl, limit = 10) {
  const origin = new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`).origin;
  const candidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap/sitemap.xml`,
    `${origin}/wp-sitemap.xml`,
  ];

  for (const sitemapUrl of candidates) {
    try {
      const { data } = await axios.get(sitemapUrl, {
        timeout: 10000,
        headers: { 'User-Agent': BOT_UA },
      });
      if (typeof data !== 'string') continue;
      const $ = cheerio.load(data, { xmlMode: true });
      const urls = [];
      // Standard sitemap: <url><loc>...</loc></url>
      $('url > loc').each((_, el) => urls.push($(el).text().trim()));
      // Sitemap index: <sitemap><loc>...</loc></sitemap> — grab first child sitemap
      if (urls.length === 0) {
        $('sitemap > loc').each((_, el) => urls.push($(el).text().trim()));
      }
      if (urls.length > 0) {
        // Prioritise homepage, about, services, product pages
        const priority = urls.filter((u) => /\/(about|services|product|home|who-we|what-we)/i.test(u));
        const rest = urls.filter((u) => !priority.includes(u));
        return [...priority, ...rest].slice(0, limit);
      }
    } catch (_) {
      // Sitemap not found at this path — try next
    }
  }
  return [];
}

/**
 * Fetch and combine text from multiple pages (sitemap-discovered URLs).
 * Returns concatenated extractedText, or null if all fail.
 */
export async function fetchSitemapContent(baseUrl, limit = 5) {
  const urls = await fetchSitemapUrls(baseUrl, 15);
  if (urls.length === 0) return null;

  const texts = [];
  for (const url of urls.slice(0, limit)) {
    try {
      const html = await fetchHtml(url);
      const { extractedText } = extractStructuredContent(html);
      if (extractedText?.trim()) texts.push(extractedText.trim());
    } catch (_) { /* skip pages we can't fetch */ }
  }
  return texts.length > 0 ? texts.join('\n\n---\n\n') : null;
}

/**
 * Extract structured content from HTML
 */
export function extractStructuredContent(html) {
  const $ = cheerio.load(html);

  const title = $('title').first().text().trim();
  const metaDescription =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    '';

  const h1 = [];
  const h2 = [];
  const h3 = [];
  $('h1').each((_, el) => h1.push($(el).text().trim()));
  $('h2').each((_, el) => h2.push($(el).text().trim()));
  $('h3').each((_, el) => h3.push($(el).text().trim()));

  const paragraphs = [];
  $('p').each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 20) paragraphs.push(text);
  });

  // Structured data (JSON-LD if present)
  let structuredData = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html() || '{}');
      if (json['@type']) structuredData = json;
      return false; // break after first
    } catch (_) {}
  });

  // Clean text for AI: combine key content
  const allText = [title, metaDescription, h1.join(' '), h2.join(' '), h3.join(' '), paragraphs.slice(0, 15).join('\n\n')]
    .filter(Boolean)
    .join('\n\n');

  return {
    title,
    metaDescription,
    h1,
    h2,
    h3,
    paragraphs,
    structuredData,
    extractedText: allText,
    rawHtml: html.substring(0, 50000), // limit for storage
  };
}
