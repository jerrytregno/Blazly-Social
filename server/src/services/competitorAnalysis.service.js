import * as competitorRepo from '../db/repositories/competitorRepository.js';
import * as userProfileRepo from '../db/userProfileRepository.js';
import { fetchHtml, extractStructuredContent } from './scraper.service.js';
import { analyzeCompetitorFromScraped } from './gemini.js';
import * as knowledgeBaseService from './knowledgeBase.service.js';
import { analyzeCompetitorSocialActivity } from './competitorSocial.service.js';

/**
 * Scrape competitor URL, run AI analysis, store in DB
 * @param {string} userId
 * @param {string} competitorName
 * @param {string} competitorUrl
 * @param {object} socialLinks - optional { linkedin, instagram, facebook, twitter } -> URL
 */
export async function scrapeAndAnalyzeCompetitor(userId, competitorName, competitorUrl, socialLinks = null) {
  const html = await fetchHtml(competitorUrl);
  const structured = extractStructuredContent(html);

  // Get user's business context for "vs you" comparison
  const userProfile = await userProfileRepo.findOne({ userId });
  const userContext = userProfile?.businessSummary
    ? `Summary: ${userProfile.businessSummary}. Industry: ${userProfile.industry || 'unknown'}.`
    : '';

  const aiAnalysis = await analyzeCompetitorFromScraped(
    structured.extractedText,
    competitorName,
    competitorUrl,
    userContext
  );

  if (aiAnalysis.error) {
    throw new Error(aiAnalysis.error);
  }

  let socialActivityReport = null;
  const socialLinksMap = socialLinks && typeof socialLinks === 'object'
    ? new Map(Object.entries(socialLinks).filter(([, v]) => v && typeof v === 'string'))
    : null;

  if (socialLinksMap && socialLinksMap.size > 0) {
    try {
      socialActivityReport = await analyzeCompetitorSocialActivity(userId, competitorName, Object.fromEntries(socialLinksMap));
    } catch (err) {
      console.warn('Competitor social activity analysis failed:', err.message);
    }
  }

  const updateData = {
    competitorName,
    competitorUrl,
    rawScrapedData: structured,
    aiAnalysis,
    lastScrapedAt: new Date(),
  };
  if (socialLinksMap && socialLinksMap.size > 0) {
    updateData.socialLinks = socialLinksMap;
  }
  if (socialActivityReport) {
    updateData.socialActivityReport = socialActivityReport;
  }

  const competitor = await competitorRepo.findOneAndUpdate(
    { userId, competitorUrl },
    updateData,
    { upsert: true, new: true }
  );

  // Store in knowledge base
  try { await knowledgeBaseService.upsertCompetitor(userId, competitorUrl, structured.extractedText, structured); } catch (_) {}

  return competitor;
}

/**
 * Analyze competitor without any DB access (used when server Firestore credentials unavailable).
 * Returns a plain object with analysis results - client saves to Firestore.
 */
export async function analyzeCompetitorOnly(competitorName, competitorUrl, socialLinks = null) {
  const html = await fetchHtml(competitorUrl);
  const structured = extractStructuredContent(html);

  const aiAnalysis = await analyzeCompetitorFromScraped(
    structured.extractedText,
    competitorName,
    competitorUrl,
    ''
  );

  if (aiAnalysis.error) throw new Error(aiAnalysis.error);

  const socialLinksObj = socialLinks && typeof socialLinks === 'object'
    ? Object.fromEntries(Object.entries(socialLinks).filter(([, v]) => v && typeof v === 'string'))
    : {};

  let socialActivityReport = null;
  if (Object.keys(socialLinksObj).length > 0) {
    try {
      socialActivityReport = await analyzeCompetitorSocialActivity(null, competitorName, socialLinksObj);
    } catch (_) {}
  }

  return {
    competitorName,
    competitorUrl,
    aiAnalysis,
    socialLinks: socialLinksObj,
    socialActivityReport,
    lastScrapedAt: new Date().toISOString(),
  };
}
