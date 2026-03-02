import { Router } from 'express';
import axios from 'axios';
import { requireAuth } from '../middleware/auth.js';
import * as postRepo from '../db/postRepository.js';
import * as integrationRepo from '../db/repositories/integrationRepository.js';
import { fetchPostAnalytics, getReportChartData, getReportPosts } from '../services/analytics.service.js';
import { isCredentialError } from '../utils/credentialError.js';

const GRAPH_BASE = 'https://graph.facebook.com/v18.0';
const THREADS_BASE = 'https://graph.threads.net/v1.0';
const TWITTER_BASE = 'https://api.twitter.com/2';

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
    if (isCredentialError(err)) return res.json({ data: [] });
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
    if (isCredentialError(err)) return res.json({ posts: [] });
    console.error('Reports posts error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /reports/analytics/refresh - Fetch analytics for all published posts in date range.
 *  Body may include: posts (client-supplied post list to avoid server Firestore lookup).
 */
router.post('/analytics/refresh', async (req, res) => {
  try {
    const { fromDate, toDate, posts: clientPosts, integrations: clientIntegrations } = req.body || {};
    let posts = clientPosts || [];

    if (!posts.length) {
      // Fallback to server Firestore
      try {
        const query = { userId: req.user._id, status: 'published' };
        if (fromDate || toDate) {
          query.publishedAt = {};
          if (fromDate) query.publishedAt.$gte = new Date(fromDate);
          if (toDate) query.publishedAt.$lte = new Date(toDate + 'T23:59:59.999Z');
        }
        posts = await postRepo.find(query, { limit: 500 });
      } catch (dbErr) {
        if (isCredentialError(dbErr)) return res.json({ fetched: 0 });
        throw dbErr;
      }
    }

    console.log('[reports] POST /analytics/refresh', { userId: req.user?._id, postCount: posts.length });
    // Parallelize analytics refresh across posts; pass client integrations to avoid server Firestore
    const results = await Promise.allSettled(
      posts.map((post) => fetchPostAnalytics(post, req.user._id, clientIntegrations || null))
    );

    // Build a map of { postId → analytics } to return to the client
    const analyticsMap = {};
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        const { postId, analytics } = r.value;
        if (postId && Object.keys(analytics || {}).length > 0) {
          analyticsMap[postId] = analytics;
        }
      }
    }
    const fetched = Object.keys(analyticsMap).length;
    console.log('[reports] refresh done, posts with analytics:', fetched);
    res.json({ fetched, analyticsMap });
  } catch (err) {
    if (isCredentialError(err)) return res.json({ fetched: 0 });
    console.error('Reports analytics refresh error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /reports/download - Download analytics as CSV (chart data + posts with analytics) */
router.get('/download', async (req, res) => {
  try {
    const { fromDate, toDate, format = 'csv' } = req.query;
    const chartData = await getReportChartData(req.user._id, fromDate, toDate);
    const posts = await getReportPosts(req.user._id, fromDate, toDate);

    const PLATFORM_LABELS = { linkedin: 'LinkedIn', instagram: 'Instagram', twitter: 'X', facebook: 'Facebook', threads: 'Threads' };
    const escapeCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    if (format === 'csv') {
      const lines = [];

      // Sheet 1: Chart data (X = date, Y = metrics per platform)
      lines.push('=== CHART DATA (Date vs Metrics by Platform) ===');
      const chartHeaders = [
        'date',
        'linkedin_impressions', 'linkedin_likes', 'linkedin_comments',
        'instagram_impressions', 'instagram_likes', 'instagram_comments',
        'twitter_impressions', 'twitter_likes', 'twitter_retweets', 'twitter_replies',
        'facebook_impressions', 'facebook_engagedUsers', 'facebook_reactions',
        'threads_views', 'threads_likes', 'threads_replies', 'threads_reposts',
      ];
      lines.push(chartHeaders.map(escapeCsv).join(','));
      for (const row of chartData) {
        lines.push(chartHeaders.map((h) => escapeCsv(row[h])).join(','));
      }

      lines.push('');
      lines.push('=== POSTS WITH INDIVIDUAL ANALYTICS ===');
      const postHeaders = ['post_id', 'content', 'published_at', 'platforms', 'platform', 'impressions', 'likes', 'comments', 'engagement', 'retweets', 'replies', 'reactions', 'views', 'reposts', 'post_url'];
      lines.push(postHeaders.map(escapeCsv).join(','));
      for (const post of posts) {
        const analytics = post.analytics || {};
        const platforms = post.platforms || [];
        const platformUrls = post.platformUrls || {};
        if (Object.keys(analytics).length === 0) {
          lines.push([
            escapeCsv(post.id),
            escapeCsv((post.content || '').slice(0, 500)),
            escapeCsv(post.publishedAt ? new Date(post.publishedAt).toISOString() : ''),
            escapeCsv(platforms.join(';')),
            '', '', '', '', '', '', '', '', '', '',
            escapeCsv(platformUrls[platforms[0]] || ''),
          ].join(','));
        } else {
          for (const [platform, m] of Object.entries(analytics)) {
            lines.push([
              escapeCsv(post.id),
              escapeCsv((post.content || '').slice(0, 500)),
              escapeCsv(post.publishedAt ? new Date(post.publishedAt).toISOString() : ''),
              escapeCsv(platforms.join(';')),
              escapeCsv(PLATFORM_LABELS[platform] || platform),
              escapeCsv(m.impressions ?? m.views ?? ''),
              escapeCsv(m.likes ?? m.engagement ?? ''),
              escapeCsv(m.comments ?? m.replies ?? ''),
              escapeCsv(m.engagement ?? ''),
              escapeCsv(m.retweets ?? ''),
              escapeCsv(m.replies ?? ''),
              escapeCsv(m.reactions ?? ''),
              escapeCsv(m.views ?? ''),
              escapeCsv(m.reposts ?? ''),
              escapeCsv(platformUrls[platform] || ''),
            ].join(','));
          }
        }
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="report-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(lines.join('\n'));
    }

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="report-${new Date().toISOString().slice(0, 10)}.json"`);
      return res.json({ chartData, posts });
    }

    res.status(400).json({ error: 'format must be csv or json' });
  } catch (err) {
    console.error('Reports download error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /reports/sync-posts
 * Fetch the user's recent posts from Facebook, Threads, and Twitter via their APIs.
 * Returns a normalized list of { platform, postId, content, publishedAt, postUrl }
 * so the client can store them in Firestore and then refresh analytics.
 */
router.post('/sync-posts', async (req, res) => {
  try {
    const { integrations: clientIntegrations = [] } = req.body || {};
    const userId = req.user._id;
    const posts = [];

    const intByPlatform = {};
    for (const i of clientIntegrations) {
      if (i.platform) intByPlatform[i.platform] = i;
    }

    // ── Facebook ──────────────────────────────────────────────────────────
    const fb = intByPlatform.facebook;
    if (fb?.facebookPageId && (fb.facebookPageAccessToken || fb.accessToken)) {
      const fbToken = fb.facebookPageAccessToken || fb.accessToken;
      try {
        const { data } = await axios.get(`${GRAPH_BASE}/${fb.facebookPageId}/posts`, {
          params: {
            fields: 'id,message,story,permalink_url,created_time',
            access_token: fbToken,
            limit: 30,
          },
        });
        for (const p of (data.data || [])) {
          if (!p.message && !p.story) continue; // Skip empty system posts
          posts.push({
            platform: 'facebook',
            postId: p.id,
            content: (p.message || p.story || '').slice(0, 500),
            publishedAt: p.created_time,
            postUrl: p.permalink_url || `https://www.facebook.com/${p.id}`,
          });
        }
        console.log(`[reports/sync] Facebook: found ${posts.filter((p) => p.platform === 'facebook').length} posts`);
      } catch (err) {
        console.warn('[reports/sync] Facebook fetch error:', err.response?.data?.error?.message || err.message);
      }
    }

    // ── Threads ───────────────────────────────────────────────────────────
    const th = intByPlatform.threads;
    if (th?.accessToken) {
      try {
        const { data } = await axios.get(`${THREADS_BASE}/me/threads`, {
          params: {
            access_token: th.accessToken,
            fields: 'id,text,timestamp,permalink,media_type',
            limit: 30,
          },
        });
        for (const t of (data.data || [])) {
          if (!t.text) continue;
          posts.push({
            platform: 'threads',
            postId: t.id,
            content: (t.text || '').slice(0, 500),
            publishedAt: t.timestamp,
            postUrl: t.permalink || `https://www.threads.net/t/${t.id}`,
          });
        }
        console.log(`[reports/sync] Threads: found ${posts.filter((p) => p.platform === 'threads').length} posts`);
      } catch (err) {
        console.warn('[reports/sync] Threads fetch error:', err.response?.data?.error?.message || err.message);
      }
    }

    // ── Twitter / X ───────────────────────────────────────────────────────
    const tw = intByPlatform.twitter;
    if (tw?.accessToken && tw?.platformUserId) {
      try {
        const { data: twData } = await axios.get(`${TWITTER_BASE}/users/${tw.platformUserId}/tweets`, {
          headers: { Authorization: `Bearer ${tw.accessToken}` },
          params: {
            max_results: 25,
            exclude: 'retweets,replies',
            'tweet.fields': 'created_at,text,public_metrics',
          },
        });
        const username = tw.platformUsername || tw.profile?.username;
        for (const t of (twData.data || [])) {
          posts.push({
            platform: 'twitter',
            postId: t.id,
            content: (t.text || '').slice(0, 500),
            publishedAt: t.created_at,
            postUrl: username ? `https://x.com/${username}/status/${t.id}` : `https://x.com/i/web/status/${t.id}`,
          });
        }
        console.log(`[reports/sync] Twitter: found ${posts.filter((p) => p.platform === 'twitter').length} tweets`);
      } catch (err) {
        console.warn('[reports/sync] Twitter fetch error:', err.response?.data?.detail || err.message);
      }
    }

    console.log(`[reports/sync] Total discovered: ${posts.length} posts across platforms`);
    res.json({ posts, total: posts.length });
  } catch (err) {
    console.error('[reports/sync] error:', err.message);
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
