import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as userRepo from '../db/userRepository.js';
import * as userProfileRepo from '../db/userProfileRepository.js';
import * as competitorRepo from '../db/repositories/competitorRepository.js';
import * as integrationRepo from '../db/repositories/integrationRepository.js';
import * as profileScrapingService from '../services/profileScraping.service.js';
import * as competitorAnalysisService from '../services/competitorAnalysis.service.js';
import { calculateProfileCompletion } from '../services/profileCompletion.service.js';
import { getProfileOptimizerSuggestions, PLATFORM_PERMISSIONS } from '../services/profileOptimizer.service.js';
import bcrypt from 'bcryptjs';

const router = Router();
router.use(requireAuth);

/** GET /api/profile - Full profile (Account + Business + Scraping info) */
router.get('/', async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await userRepo.findById(userId);
    if (user?.password) delete user.password;
    const userProfile = await userProfileRepo.findOne({ userId });
    const competitors = await competitorRepo.find({ userId }, { sort: { lastScrapedAt: -1 } });
    const integrations = await integrationRepo.find({ userId, isActive: true });

    res.json({
      account: {
        name: user?.name ?? ([user?.profile?.firstName, user?.profile?.lastName].filter(Boolean).join(' ') || ''),
        email: user?.email,
        timezone: user?.timezone ?? 'UTC',
        profileCompletion: user?.profileCompletion ?? 0,
        onboardingStep: user?.onboardingStep ?? 1,
      },
      businessProfile: userProfile
        ? {
            businessName: userProfile.businessName,
            websiteUrl: userProfile.websiteUrl,
            businessSummary: userProfile.businessSummary,
            brandTone: userProfile.brandTone,
            keywords: userProfile.keywords || [],
            industry: userProfile.industry,
            targetAudience: userProfile.targetAudience,
            valueProposition: userProfile.valueProposition,
            lastScrapedAt: userProfile.lastScrapedAt,
            customScraperApiUrl: userProfile.customScraperApiUrl,
          }
        : null,
      scraping: {
        lastScrapedAt: userProfile?.lastScrapedAt,
        competitorCount: competitors.length,
      },
      competitors: competitors.map((c) => ({
        id: (c._id || c.id)?.toString(),
        competitorName: c.competitorName,
        competitorUrl: c.competitorUrl,
        lastScrapedAt: c.lastScrapedAt,
      })),
      integrations: integrations.map((i) => ({ platform: i.platform, profile: i.profile })),
    });
  } catch (err) {
    console.error('Error fetching profile:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

/** PATCH /api/profile - Update account + business profile */
router.patch('/', async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      name,
      timezone,
      onboardingStep,
      businessName,
      websiteUrl,
      businessSummary,
      brandTone,
      keywords,
      industry,
      targetAudience,
      valueProposition,
    } = req.body || {};

    if (name !== undefined) {
      req.user.name = String(name).trim();
      await userRepo.findByIdAndUpdate(userId, { name: req.user.name }, { new: true });
    }
    if (timezone !== undefined) {
      req.user.timezone = String(timezone) || 'UTC';
      await userRepo.findByIdAndUpdate(userId, { timezone: req.user.timezone }, { new: true });
    }
    if (onboardingStep !== undefined && onboardingStep >= 1 && onboardingStep <= 5) {
      req.user.onboardingStep = onboardingStep;
      await userRepo.findByIdAndUpdate(userId, { onboardingStep }, { new: true });
    }

    const profile = await userProfileRepo.findOneAndUpdate(
      { userId },
      {
        ...(businessName !== undefined && { businessName }),
        ...(websiteUrl !== undefined && { websiteUrl }),
        ...(businessSummary !== undefined && { businessSummary }),
        ...(brandTone !== undefined && { brandTone }),
        ...(keywords !== undefined && Array.isArray(keywords) && { keywords }),
        ...(industry !== undefined && { industry }),
        ...(targetAudience !== undefined && { targetAudience }),
        ...(valueProposition !== undefined && { valueProposition }),
        ...(req.body.customScraperApiUrl !== undefined && { customScraperApiUrl: req.body.customScraperApiUrl?.trim() || null }),
      },
      { upsert: true, new: true }
    );

    const completion = await calculateProfileCompletion(req.user);
    await userRepo.findByIdAndUpdate(userId, { profileCompletion: completion });

    res.json({
      ok: true,
      profileCompletion: completion,
      account: { name: req.user.name, timezone: req.user.timezone, onboardingStep: req.user.onboardingStep },
      businessProfile: profile,
    });
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

/** POST /api/profile/password - Change password */
router.post('/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!req.user.password) {
      return res.status(400).json({ error: 'Account uses external auth; password change not available' });
    }
    if (!currentPassword || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Current password and new password (min 6 chars) required' });
    }
    const match = await userRepo.comparePassword(req.user, currentPassword);
    if (!match) return res.status(400).json({ error: 'Current password is incorrect' });
    const hashed = await bcrypt.hash(newPassword, 10);
    await userRepo.findByIdAndUpdate(req.user._id, { password: hashed });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update password' });
  }
});

/** POST /api/profile/scrape - Scrape own website and update business profile */
router.post('/scrape', async (req, res) => {
  try {
    const { websiteUrl, customScraperApiUrl } = req.body || {};
    if (!websiteUrl || typeof websiteUrl !== 'string') {
      return res.status(400).json({ error: 'websiteUrl is required' });
    }
    const profile = await profileScrapingService.scrapeAndUpdateProfile(
      req.user._id,
      websiteUrl.trim(),
      customScraperApiUrl?.trim() || null
    );
    res.json({ ok: true, businessProfile: profile });
  } catch (err) {
    console.error('Scrape error:', err);
    res.status(400).json({ error: err.message || 'Failed to scrape website' });
  }
});

/** POST /api/profile/competitors - Add competitor */
router.post('/competitors', async (req, res) => {
  try {
    const { competitorName, competitorUrl, socialLinks } = req.body || {};
    if (!competitorName || !competitorUrl) {
      return res.status(400).json({ error: 'competitorName and competitorUrl are required' });
    }
    const competitor = await competitorAnalysisService.scrapeAndAnalyzeCompetitor(
      req.user._id,
      competitorName.trim(),
      competitorUrl.trim(),
      socialLinks || null
    );
    const completion = await calculateProfileCompletion(req.user);
    await userRepo.findByIdAndUpdate(req.user._id, { profileCompletion: completion });
    const compObj = competitor;
    compObj.id = compObj._id?.toString?.() || compObj.id;
    compObj.socialLinks = competitor.socialLinks
      ? (competitor.socialLinks instanceof Map ? Object.fromEntries(competitor.socialLinks) : competitor.socialLinks)
      : {};
    res.status(201).json({ ok: true, competitor: compObj });
  } catch (err) {
    console.error('Competitor scrape error:', err);
    res.status(400).json({ error: err.message || 'Failed to add competitor' });
  }
});

/** GET /api/profile/competitors - List competitors with full analysis */
router.get('/competitors', async (req, res) => {
  try {
    const competitors = await competitorRepo.find({ userId: req.user._id }, { sort: { lastScrapedAt: -1 } });
    res.json(
      competitors.map((c) => ({
        id: (c._id || c.id)?.toString(),
        competitorName: c.competitorName,
        competitorUrl: c.competitorUrl,
        socialLinks: c.socialLinks
          ? (c.socialLinks instanceof Map ? Object.fromEntries(c.socialLinks) : c.socialLinks)
          : {},
        socialActivityReport: c.socialActivityReport,
        aiAnalysis: c.aiAnalysis,
        lastScrapedAt: c.lastScrapedAt,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch competitors' });
  }
});

/** GET /api/profile/optimizer - AI profile optimization suggestions for connected platforms */
router.get('/optimizer', async (req, res) => {
  try {
    const { platform } = req.query;
    const results = await getProfileOptimizerSuggestions(req.user._id, platform || null);
    res.json({ platforms: results });
  } catch (err) {
    console.error('Profile optimizer error:', err);
    res.status(500).json({ error: 'Failed to load profile suggestions' });
  }
});

/** GET /api/profile/optimizer/permissions - Platform API permissions reference */
router.get('/optimizer/permissions', (req, res) => {
  res.json(PLATFORM_PERMISSIONS);
});

/** POST /api/profile/competitors/:id/rescrape - Rescrape competitor */
router.post('/competitors/:id/rescrape', async (req, res) => {
  try {
    const comp = await competitorRepo.findOne({ _id: req.params.id, userId: req.user._id });
    if (!comp) return res.status(404).json({ error: 'Competitor not found' });
    const existingSocialLinks = comp.socialLinks ? Object.fromEntries(comp.socialLinks) : null;
    const competitor = await competitorAnalysisService.scrapeAndAnalyzeCompetitor(
      req.user._id,
      comp.competitorName,
      comp.competitorUrl,
      existingSocialLinks
    );
    res.json({ ok: true, competitor });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to rescrape' });
  }
});

export default router;
