import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

/** GET /api/scheduling/suggested-times - AI-suggested posting times per platform (seed data for now) */
router.get('/suggested-times', (req, res) => {
  // Seed data - in production this could be derived from user timezone + engagement analytics
  const times = {
    linkedin: ['09:00', '13:30'],
    twitter: ['08:00', '18:00'],
    instagram: ['12:00', '20:00'],
    facebook: ['10:00', '19:00'],
    threads: ['09:30', '17:00'],
  };
  res.json(times);
});

export default router;
