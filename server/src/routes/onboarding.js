import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as userRepo from '../db/userRepository.js';
import * as userProfileRepo from '../db/userProfileRepository.js';
import * as competitorRepo from '../db/repositories/competitorRepository.js';
import * as integrationRepo from '../db/repositories/integrationRepository.js';
import { calculateProfileCompletion } from '../services/profileCompletion.service.js';

const router = Router();
router.use(requireAuth);

/** GET /api/onboarding - Current state */
router.get('/', async (req, res) => {
  const userId = req.user._id;
  const [user, profile, competitors, integrations] = await Promise.all([
    userRepo.findById(userId),
    userProfileRepo.findOne({ userId }),
    competitorRepo.find({ userId }),
    integrationRepo.find({ userId }),
  ]);
  const competitorCount = competitors.length;
  const integrationCount = integrations.length;

  const completion = await calculateProfileCompletion(user, { profile, competitors, integrations });

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
    await userRepo.findByIdAndUpdate(req.user._id, { onboardingStep: step }, { new: true });
  }

  const user = await userRepo.findById(req.user._id);
  const completion = await calculateProfileCompletion(user || req.user);
  await userRepo.findByIdAndUpdate(req.user._id, { profileCompletion: completion });

  res.json({
    step: req.user.onboardingStep,
    profileCompletion: completion,
  });
});

export default router;
