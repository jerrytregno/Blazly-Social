import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as integrationRepo from '../db/repositories/integrationRepository.js';

const router = Router();
router.use(requireAuth);

// Get all integrations for the current user
router.get('/', async (req, res) => {
  try {
    const integrations = await integrationRepo.find({
      userId: req.user._id,
      isActive: true,
    });
    // Strip sensitive tokens before sending to client
    const safe = integrations.map((i) => {
      const { accessToken, accessTokenSecret, refreshToken, ...rest } = i;
      return rest;
    });
    res.json(safe);
  } catch (err) {
    console.error('Error fetching integrations:', err);
    res.status(500).json({ error: 'Failed to fetch integrations' });
  }
});

// Get a specific integration
router.get('/:platform', async (req, res) => {
  try {
    const integration = await integrationRepo.findOne({
      userId: req.user._id,
      platform: req.params.platform,
      isActive: true,
    });

    if (!integration) {
      return res.status(404).json({ error: 'Integration not found' });
    }

    const { accessToken, accessTokenSecret, refreshToken, ...safeIntegration } = integration;
    res.json(safeIntegration);
  } catch (err) {
    console.error('Error fetching integration:', err);
    res.status(500).json({ error: 'Failed to fetch integration' });
  }
});

// Disconnect/delete an integration
router.delete('/:id', async (req, res) => {
  try {
    const integration = await integrationRepo.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!integration) {
      return res.status(404).json({ error: 'Integration not found' });
    }

    await integrationRepo.findOneAndUpdate(
      { userId: req.user._id, platform: integration.platform },
      { isActive: false },
      { new: true }
    );

    res.json({ ok: true, message: 'Integration disconnected successfully' });
  } catch (err) {
    console.error('Error disconnecting integration:', err);
    res.status(500).json({ error: 'Failed to disconnect integration' });
  }
});

export default router;
