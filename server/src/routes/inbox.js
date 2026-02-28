import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as integrationRepo from '../db/repositories/integrationRepository.js';
import * as userRepo from '../db/userRepository.js';
import {
  fetchUnifiedInbox,
  generateAiReply,
  replyToInstagramComment,
  replyToFacebookComment,
  replyToLinkedInComment,
} from '../services/inbox.service.js';

const router = Router();
router.use(requireAuth);

/** GET /api/inbox - Fetch unified comments from all connected platforms */
router.get('/', async (req, res) => {
  try {
    const items = await fetchUnifiedInbox(req.user._id);
    res.json({ items });
  } catch (err) {
    console.error('Inbox fetch error:', err);
    res.status(500).json({ error: 'Failed to load inbox' });
  }
});

/** POST /api/inbox/ai-reply - Generate AI reply suggestion */
router.post('/ai-reply', async (req, res) => {
  try {
    const { commentText, platform } = req.body || {};
    if (!commentText) return res.status(400).json({ error: 'commentText required' });
    const instructions = req.user?.aiInstructions?.global || '';
    const reply = await generateAiReply(commentText, platform || 'instagram', instructions);
    res.json({ reply });
  } catch (err) {
    console.error('AI reply error:', err);
    res.status(500).json({ error: 'Failed to generate reply' });
  }
});

/** POST /api/inbox/reply - Send reply to a comment */
router.post('/reply', async (req, res) => {
  try {
    const { commentId, platform, replyText } = req.body || {};
    if (!commentId || !replyText) return res.status(400).json({ error: 'commentId and replyText required' });

    const integrations = await integrationRepo.find({ userId: req.user._id, isActive: true });
    let token = null;

    if (platform === 'instagram') {
      const int = integrations.find((i) => i.platform === 'instagram');
      token = int?.instagramPageAccessToken;
    } else if (platform === 'facebook') {
      const int = integrations.find((i) => i.platform === 'facebook');
      token = int?.facebookPageAccessToken;
    } else if (platform === 'linkedin') {
      const int = integrations.find((i) => i.platform === 'linkedin');
      token = int?.accessToken;
    }

    if (!token) return res.status(400).json({ error: 'Platform not connected or no permission' });

    let result;
    if (platform === 'instagram') {
      result = await replyToInstagramComment(commentId, replyText, token);
    } else if (platform === 'facebook') {
      result = await replyToFacebookComment(commentId, replyText, token);
    } else if (platform === 'linkedin') {
      const { postUrn, parentCommentUrn } = req.body || {};
      const shareUrn = postUrn || req.body?.postId;
      if (!shareUrn) return res.status(400).json({ error: 'postUrn required for LinkedIn reply' });
      result = await replyToLinkedInComment(shareUrn, commentId, replyText, token, parentCommentUrn);
    } else {
      return res.status(400).json({ error: 'Platform not supported for replies' });
    }

    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    console.error('Reply error:', err);
    res.status(500).json({ error: 'Failed to send reply' });
  }
});

/** GET /api/inbox/settings - Get auto-reply setting */
router.get('/settings', async (req, res) => {
  try {
    const user = await userRepo.findById(req.user._id);
    res.json({ autoReplyEnabled: user?.settings?.inboxAutoReply === true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

/** PATCH /api/inbox/settings - Update auto-reply setting */
router.patch('/settings', async (req, res) => {
  try {
    const { autoReplyEnabled } = req.body || {};
    const user = await userRepo.findById(req.user._id);
    const settings = { ...(user?.settings || {}), inboxAutoReply: !!autoReplyEnabled };
    await userRepo.findByIdAndUpdate(req.user._id, { settings });
    res.json({ ok: true, autoReplyEnabled: !!autoReplyEnabled });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

export default router;
