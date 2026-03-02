import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as keywordPollRepo from '../db/keywordPollRepository.js';
import * as keywordMatchRepo from '../db/keywordMatchRepository.js';
import { runKeywordPoll } from '../services/keywordPolling.service.js';
import { isCredentialError } from '../utils/credentialError.js';

const router = Router();
router.use(requireAuth);

/** GET /keyword-poll - Get user's keyword poll config */
router.get('/', async (req, res) => {
  try {
    const poll = await keywordPollRepo.findOne({ userId: req.user._id });
    res.json({
      keywords: poll?.keywords || [],
      platforms: poll?.platforms || ['twitter', 'linkedin'],
      enabled: poll?.enabled ?? true,
      lastPolledAt: poll?.lastPolledAt,
    });
  } catch (err) {
    if (isCredentialError(err)) return res.json({ keywords: [], platforms: ['twitter', 'linkedin'], enabled: false });
    console.error('Keyword poll get error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /keyword-poll - Update keywords and config */
router.patch('/', async (req, res) => {
  try {
    const { keywords, platforms, enabled } = req.body || {};
    const update = {};
    if (keywords !== undefined && Array.isArray(keywords)) update.keywords = keywords.filter(Boolean).map(String);
    if (platforms !== undefined && Array.isArray(platforms)) {
      const allowed = ['twitter', 'linkedin', 'instagram', 'facebook', 'threads'];
      const filtered = platforms.filter((p) => allowed.includes(p));
      update.platforms = filtered.length ? filtered : ['twitter', 'linkedin'];
    }
    if (enabled !== undefined) update.enabled = !!enabled;

    const poll = await keywordPollRepo.findOneAndUpdate(
      { userId: req.user._id },
      update,
      { upsert: true, new: true }
    );
    res.json({
      keywords: poll.keywords,
      platforms: poll.platforms,
      enabled: poll.enabled,
      lastPolledAt: poll.lastPolledAt,
    });
  } catch (err) {
    if (isCredentialError(err)) return res.json({ ok: true });
    console.error('Keyword poll update error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /keyword-poll/run - Trigger poll now.
 *  Body may include: keywords, platforms, integrations (array) for client-mode (no server Firestore).
 */
router.post('/run', async (req, res) => {
  try {
    const { keywords, platforms, integrations } = req.body || {};

    // Build opts from client-supplied data when available
    const opts = {};
    if (keywords?.length || platforms?.length) {
      opts.pollConfig = { keywords: keywords || [], platforms: platforms || ['twitter', 'linkedin'], enabled: true };
    }
    if (integrations?.length) {
      // Build lookup by platform from the integrations array
      opts.integrationsByPlatform = {};
      for (const intg of integrations) {
        if (intg.platform && intg.isActive !== false) {
          opts.integrationsByPlatform[intg.platform] = intg;
        }
      }
    }

    console.log('[Keyword poll] POST /run triggered by user', req.user._id, 'platforms:', opts.pollConfig?.platforms || 'from DB');
    const result = await runKeywordPoll(req.user._id, opts);
    console.log('[Keyword poll] Result:', result.matched, 'matches');
    res.json(result);
  } catch (err) {
    if (isCredentialError(err)) return res.json({ matched: 0, matches: [] });
    console.error('Keyword poll run error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /keyword-poll/matches - List recent keyword matches (filter by selected platforms) */
router.get('/matches', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const unreadOnly = req.query.unread === 'true';
    const platformsParam = req.query.platforms;
    const query = { userId: req.user._id };
    if (unreadOnly) query.read = false;
    if (platformsParam) {
      const platforms = platformsParam.split(',').filter(Boolean);
      if (platforms.length) query.platform = { $in: platforms };
    }

    const matches = await keywordMatchRepo.find(query, {
      sort: { createdAt: -1 },
      limit,
    });
    res.json({ matches });
  } catch (err) {
    if (isCredentialError(err)) return res.json({ matches: [] });
    console.error('Keyword poll matches error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /keyword-poll/matches/:id/read - Mark match as read */
router.patch('/matches/:id/read', async (req, res) => {
  try {
    await keywordMatchRepo.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { read: true },
      { new: false }
    );
    res.json({ ok: true });
  } catch (err) {
    if (isCredentialError(err)) return res.json({ ok: true });
    res.status(500).json({ error: err.message });
  }
});

export default router;
