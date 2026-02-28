import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as postRepo from '../db/postRepository.js';
import * as integrationRepo from '../db/repositories/integrationRepository.js';
import { fetchPostAnalytics, getReportChartData, getReportPosts } from '../services/analytics.service.js';

const router = Router();
router.use((req, res, next) => {
  console.log('[reports]', req.method, req.path || req.url);
  next();
});
router.use(requireAuth);

/** GET /reports/analytics - Chart data for report page (date vs metrics) */
router.get('/analytics', async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    console.log('[reports] GET /analytics', { userId: req.user?._id, fromDate, toDate });
    const data = await getReportChartData(req.user._id, fromDate, toDate);
    console.log('[reports] analytics response:', { rows: data?.length, sample: data?.[0] });
    res.json({ data });
  } catch (err) {
    console.error('Reports analytics error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /reports/posts - Post history with analytics for report page */
router.get('/posts', async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    console.log('[reports] GET /posts', { userId: req.user?._id, fromDate, toDate });
    const posts = await getReportPosts(req.user._id, fromDate, toDate);
    const withAnalytics = posts.filter((p) => Object.keys(p.analytics || {}).length > 0).length;
    console.log('[reports] posts response:', { total: posts.length, withAnalytics });
    res.json({ posts });
  } catch (err) {
    console.error('Reports posts error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /reports/analytics/refresh - Fetch analytics for all published posts in date range */
router.post('/analytics/refresh', async (req, res) => {
  try {
    const { fromDate, toDate } = req.body;
    const query = { userId: req.user._id, status: 'published' };
    if (fromDate || toDate) {
      query.publishedAt = {};
      if (fromDate) query.publishedAt.$gte = new Date(fromDate);
      if (toDate) query.publishedAt.$lte = new Date(toDate + 'T23:59:59.999Z');
    }
    const posts = await postRepo.find(query, { limit: 500 });
    console.log('[reports] POST /analytics/refresh', { userId: req.user?._id, fromDate, toDate, postCount: posts.length });
    let fetched = 0;
    for (const post of posts) {
      const platformIds = post.platformIds instanceof Map ? Object.fromEntries(post.platformIds) : (post.platformIds || {});
      console.log('[reports] refreshing post', post._id, 'platformIds:', Object.keys(platformIds));
      const analytics = await fetchPostAnalytics(post, req.user._id);
      if (Object.keys(analytics).length > 0) fetched++;
    }
    console.log('[reports] refresh done, posts with analytics:', fetched);
    res.json({ fetched });
  } catch (err) {
    console.error('Reports analytics refresh error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /reports/debug - Diagnostic info for empty analytics */
router.get('/debug', async (req, res) => {
  try {
    const posts = await postRepo.find(
      { userId: req.user._id, status: 'published' },
      { limit: 5 }
    );
    const integrations = await integrationRepo.find({ userId: req.user._id, isActive: true });
    const debug = {
      postCount: await postRepo.countDocuments({ userId: req.user._id, status: 'published' }),
      samplePosts: posts.map((p) => ({
        id: p._id,
        platforms: p.platforms,
        platformIds: p.platformIds instanceof Map ? Object.fromEntries(p.platformIds) : p.platformIds || {},
        hasAnalytics: Object.keys(p.analytics || {}).length > 0,
      })),
      integrations: integrations.map((i) => ({
        platform: i.platform,
        hasToken: !!i.accessToken,
        hasPageToken: !!(i.instagramPageAccessToken || i.facebookPageAccessToken),
      })),
    };
    console.log('[reports] debug:', JSON.stringify(debug, null, 2));
    res.json(debug);
  } catch (err) {
    console.error('Reports debug error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
