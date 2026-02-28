import * as userProfileRepo from '../db/userProfileRepository.js';
import * as trendInsightRepo from '../db/repositories/trendInsightRepository.js';
import { generateTrendIdeas } from './gemini.js';

// Seed trend data (replace with real API e.g. Google Trends, Twitter API)
const SEED_TRENDS = [
  { term: 'AI content', change: '+24%', direction: 'up', rank: 1 },
  { term: 'social media automation', change: '+18%', direction: 'up', rank: 2 },
  { term: 'content marketing', change: '+8%', direction: 'up', rank: 3 },
  { term: 'sustainability', change: '+19%', direction: 'up', rank: 4 },
  { term: 'thought leadership', change: '+9%', direction: 'up', rank: 5 },
];

/**
 * Poll trend data, merge with user keywords, send to Gemini, store TrendInsight
 */
export async function pollAndGenerateInsights(userId) {
  const profile = await userProfileRepo.findOne({ userId });
  const keywords = profile?.keywords?.length ? profile.keywords : ['social media', 'content', 'marketing'];
  const businessContext = profile?.businessSummary
    ? `Business: ${profile.businessSummary}. Industry: ${profile.industry || 'general'}.`
    : '';

  const trendData = { trends: SEED_TRENDS, polledAt: new Date().toISOString() };
  const aiResult = await generateTrendIdeas(keywords, trendData, businessContext);

  if (aiResult.error) {
    console.error('Trend insight generation failed:', aiResult.error);
    return null;
  }

  const insight = await trendInsightRepo.create({
    userId,
    keywords,
    trendData,
    aiSuggestion: {
      postIdea: aiResult.postIdea,
      strategySuggestion: aiResult.strategySuggestion,
      alertMessage: aiResult.alertMessage,
    },
  });

  return insight;
}
