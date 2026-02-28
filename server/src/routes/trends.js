import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as trendInsightRepo from '../db/repositories/trendInsightRepository.js';
import * as userProfileRepo from '../db/userProfileRepository.js';
import * as ideaCacheRepo from '../db/ideaCacheRepository.js';
import * as userRepo from '../db/userRepository.js';
import { generateContentIdeas } from '../services/gemini.js';
import { fetchPlatformTrends } from '../services/platformTrends.service.js';

const router = Router();

const TREND_CATEGORIES = {
  social: {
    label: 'Social & Content',
    description: 'What creators and marketers are talking about',
    trends: [
      { term: 'AI content', change: '+24%', direction: 'up', rank: 1 },
      { term: 'social media automation', change: '+18%', direction: 'up', rank: 2 },
      { term: 'LinkedIn tips', change: '+12%', direction: 'up', rank: 3 },
      { term: 'content marketing', change: '+8%', direction: 'up', rank: 4 },
      { term: 'Instagram Reels', change: '+6%', direction: 'up', rank: 5 },
      { term: 'threads app', change: '-5%', direction: 'down', rank: 6 },
    ],
  },
  business: {
    label: 'Business',
    description: 'Professional and B2B topics gaining traction',
    trends: [
      { term: 'remote work', change: '+22%', direction: 'up', rank: 1 },
      { term: 'startup funding', change: '+15%', direction: 'up', rank: 2 },
      { term: 'sustainability', change: '+19%', direction: 'up', rank: 3 },
      { term: 'SaaS growth', change: '+11%', direction: 'up', rank: 4 },
      { term: 'thought leadership', change: '+9%', direction: 'up', rank: 5 },
      { term: 'web3', change: '-12%', direction: 'down', rank: 6 },
    ],
  },
  tech: {
    label: 'Tech',
    description: 'Technology and tools trending now',
    trends: [
      { term: 'generative AI', change: '+31%', direction: 'up', rank: 1 },
      { term: 'no-code tools', change: '+14%', direction: 'up', rank: 2 },
      { term: 'automation', change: '+17%', direction: 'up', rank: 3 },
      { term: 'cybersecurity', change: '+8%', direction: 'up', rank: 4 },
      { term: 'coding tutorials', change: '+6%', direction: 'up', rank: 5 },
      { term: 'NFT', change: '-18%', direction: 'down', rank: 6 },
    ],
  },
};

/** GET /trends/ideas - Cached content ideas (returns cache if available) */
router.get('/ideas', requireAuth, async (req, res) => {
  try {
    const cache = await ideaCacheRepo.findOne({ userId: req.user._id });
    if (cache?.ideas?.length) {
      return res.json({
        ideas: cache.ideas,
        cached: true,
        generatedAt: cache.generatedAt,
        keywords: cache.keywords,
        category: cache.category,
      });
    }
    res.json({ ideas: [], cached: false });
  } catch (err) {
    console.error('Trends ideas cache error:', err);
    res.status(500).json({ error: 'Failed to fetch ideas' });
  }
});

/** POST /trends/ideas/generate - Generate ideas with custom instruction, cache result */
router.post('/ideas/generate', requireAuth, async (req, res) => {
  try {
    const profile = await userProfileRepo.findOne({ userId: req.user._id });
    const user = await userRepo.findById(req.user._id);
    const keywords = profile?.keywords?.length ? profile.keywords : ['social media', 'content', 'marketing'];
    const businessContext = [profile?.businessSummary, profile?.businessName].filter(Boolean).join('. ');
    const customInstruction =
      req.body?.customInstruction ||
      (user?.aiInstructions?.useGlobalForAll ? user?.aiInstructions?.global : '') ||
      '';

    const category = req.body?.category || req.query?.category || 'social';
    const data = TREND_CATEGORIES[category] || TREND_CATEGORIES.social;
    const trendData = { trends: data.trends, polledAt: new Date().toISOString(), category: data.label };

    const result = await generateContentIdeas(keywords, trendData, businessContext, customInstruction);
    const ideas = result.ideas || [];

    await ideaCacheRepo.findOneAndUpdate(
      { userId: req.user._id },
      {
        userId: req.user._id,
        ideas,
        customInstruction,
        keywords,
        category,
        generatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    res.json({ ideas, keywords, category });
  } catch (err) {
    console.error('Trends ideas generate error:', err);
    res.status(500).json({ error: 'Failed to generate ideas' });
  }
});

/** GET /trends/platforms - Live trending topics from Twitter, LinkedIn, Instagram, Facebook, Threads */
router.get('/platforms', requireAuth, async (req, res) => {
  try {
    const data = await fetchPlatformTrends(req.user._id);
    res.json(data);
  } catch (err) {
    console.error('Platform trends error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/', requireAuth, (req, res) => {
  const category = req.query.category || 'social';
  const data = TREND_CATEGORIES[category] || TREND_CATEGORIES.social;
  res.json({
    categories: Object.keys(TREND_CATEGORIES).map((k) => ({ id: k, label: TREND_CATEGORIES[k].label })),
    category: category,
    description: data.description,
    howItWorks: 'These trends reflect rising/falling interest from search and social signals. Updates reflect the past 3 months. Use them to align your content with what audiences care about.',
    trends: data.trends,
    link: 'https://trends.google.com/trends/explore?date=today%203-m&geo=US',
  });
});

/** GET /trends/insights - AI-generated trend insights for the user */
router.get('/insights', requireAuth, async (req, res) => {
  try {
    const insights = await trendInsightRepo.find(
      { userId: req.user._id },
      { sort: { createdAt: -1 }, limit: 20 }
    );
    res.json(insights.map((i) => ({
      id: (i._id || i.id)?.toString(),
      keywords: i.keywords,
      trendData: i.trendData,
      aiSuggestion: i.aiSuggestion,
      read: i.read,
      createdAt: i.createdAt,
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch insights' });
  }
});

/** PATCH /trends/insights/:id/read - Mark insight as read */
router.patch('/insights/:id/read', requireAuth, async (req, res) => {
  try {
    const updated = await trendInsightRepo.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { read: true },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: 'Insight not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update' });
  }
});

export default router;
