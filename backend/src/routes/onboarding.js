import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { User } from '../models/User.js';
import { UserProfile } from '../models/UserProfile.js';
import { Competitor } from '../models/Competitor.js';
import { Integration } from '../models/Integration.js';
import { calculateProfileCompletion } from '../services/profileCompletion.service.js';

const router = Router();
router.use(requireAuth);

/** GET /api/onboarding - Current state */
router.get('/', async (req, res) => {
  const userId = req.user._id;
  const user = await User.findById(userId);
  const profile = await UserProfile.findOne({ userId });
  const competitorCount = await Competitor.countDocuments({ userId });
  const integrationCount = await Integration.countDocuments({ userId });

  const completion = await calculateProfileCompletion(user);

  const step = user?.onboardingStep ?? 1;
  res.json({
    step: step > 4 ? 4 : step,
    profileCompletion: completion,
    steps: {
      basicInfo: !!(user?.name && user.name.trim()),
      businessDetails: !!(profile?.businessName || profile?.businessSummary),
      ownWebsiteScraped: !!(profile?.websiteUrl && profile?.lastScrapedAt),
      competitorAdded: competitorCount > 0,
      integrationsConnected: integrationCount > 0,
      timezoneSelected: !!(user?.timezone && user.timezone !== 'UTC'),
    },
  });
});

/** PATCH /api/onboarding - Update step (and optionally skip) */
router.patch('/', async (req, res) => {
  const { step, skip } = req.body || {};
  if (step !== undefined && step >= 1 && step <= 5) {
    req.user.onboardingStep = step;
    await req.user.save();
  }

  const completion = await calculateProfileCompletion(req.user);
  await User.findByIdAndUpdate(req.user._id, { profileCompletion: completion });

  res.json({
    step: req.user.onboardingStep,
    profileCompletion: completion,
  });
});

export default router;
