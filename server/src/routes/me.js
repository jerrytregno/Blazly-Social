import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

/**
 * /api/me - User info from Firebase token (no Firestore on server).
 * Extended profile (name, timezone, etc.) is stored in Firestore - client fetches/updates directly.
 */
const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const u = req.user;
    res.json({
      id: u._id,
      uid: u.uid,
      name: u.name || u.profile?.name || '',
      email: u.email,
      timezone: u.timezone ?? 'UTC',
      profileCompletion: u.profileCompletion ?? 0,
      onboardingStep: u.onboardingStep ?? 1,
      profile: u.profile || {},
      settings: u.settings || {},
      aiInstructions: u.aiInstructions || { global: '', useGlobalForAll: true, platforms: {} },
    });
  } catch (err) {
    console.error('Error in /me:', err);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

/** PATCH /me - Updates are done client-side in Firestore. This endpoint kept for compatibility. */
router.patch('/', async (req, res) => {
  res.status(400).json({
    error: 'Profile updates are done in the app. Refresh the page to see changes.',
  });
});

export default router;
