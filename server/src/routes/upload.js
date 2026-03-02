import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

/**
 * Image upload is done client-side (Firebase Storage + rules).
 * No backend/service account needed. Sign in with Google to upload.
 */
const router = Router();
router.use(requireAuth);

router.post('/', (req, res) => {
  res.status(400).json({
    error: 'Sign in with Google to upload images. Uploads go directly to Firebase Storage (no backend).',
  });
});

export default router;
