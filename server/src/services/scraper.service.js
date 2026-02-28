import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Fetch HTML from URL with timeout and user-agent
 */
export async function fetchHtml(url) {
  const normalized = url.startsWith('http') ? url : `https://${url}`;
  const { data } = await axios.get(normalized, {
    timeout: 15000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; BlazlyBot/1.0; +https://blazly.app)',
    },
  });
  return data;
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
