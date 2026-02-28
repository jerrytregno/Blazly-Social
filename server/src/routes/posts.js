import { Router } from 'express';
import axios from 'axios';
import { config } from '../config.js';
import * as postRepo from '../db/postRepository.js';
import * as integrationRepo from '../db/repositories/integrationRepository.js';
import { requireAuth } from '../middleware/auth.js';
import { canMakeLinkedInCall, incrementLinkedInUsage } from '../services/rateLimit.js';
import { createPost as createLinkedInPost, createPostWithImage as createLinkedInImagePost, buildAuthorUrn, getMemberId } from '../services/linkedin.js';
import { createPost as createFacebookPost, createPhotoPost as createFacebookPhotoPost } from '../services/facebook.js';
import { createPost as createTwitterPost, uploadMedia as uploadTwitterMedia, refreshAccessToken as refreshTwitterToken } from '../services/twitter.js';
import { createPost as createThreadsPost } from '../services/threads.js';
import { createPost as createInstagramPost, createInstagramMediaContainer, publishInstagramMedia, getInstagramPublishingLimit, waitForMediaReady } from '../services/instagram.js';
import { resolveImageUrl } from '../utils/imageUrl.js';
import { storeLinkedInPostInFirebase } from '../services/linkedinStorage.service.js';

const router = Router();
router.use(requireAuth);

function formatPostForResponse(post) {
  const obj = post;
  obj.id = (obj._id || post._id)?.toString();
  obj.errors = obj.platformErrors || obj.errors || [];
  return obj;
}

router.get('/', async (req, res) => {
  try {
    const limit = req.query.format ? Math.min(parseInt(req.query.limit) || 5000, 5000) : (parseInt(req.query.limit) || 10);
    const startAfter = req.query.startAfter;
    const platform = req.query.platform;
    const fromDate = req.query.fromDate;
    const toDate = req.query.toDate;
    const status = req.query.status;
    const format = req.query.format;

    const baseQuery = { userId: req.user._id };
    if (platform) baseQuery.platforms = { $in: [platform] };
    if (status) baseQuery.status = status;
    if (fromDate || toDate) {
      baseQuery.createdAt = {};
      if (fromDate) baseQuery.createdAt.$gte = new Date(fromDate);
      if (toDate) baseQuery.createdAt.$lte = new Date(toDate + 'T23:59:59.999Z');
    }

    const queryOpts = { limit };
    if (startAfter) baseQuery._id = { $lt: startAfter };

    const posts = await postRepo.find(baseQuery, queryOpts);
    const total = await postRepo.countDocuments(baseQuery);

    const formattedPosts = posts.map(doc => formatPostForResponse(doc));

    if (format === 'csv') {
      const headers = ['id', 'content', 'platforms', 'status', 'createdAt', 'publishedAt', 'scheduledAt'];
      const rows = formattedPosts.map(p => [
        p.id,
        (p.content || '').replace(/"/g, '""'),
        (p.platforms || []).join(';'),
        p.status || '',
        p.createdAt ? new Date(p.createdAt).toISOString() : '',
        p.publishedAt ? new Date(p.publishedAt).toISOString() : '',
        p.scheduledAt ? new Date(p.scheduledAt).toISOString() : '',
      ].map(c => `"${String(c)}"`).join(','));
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=posts.csv');
      return res.send(['"' + headers.join('","') + '"', ...rows].join('\n'));
    }

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=posts.json');
      return res.send(JSON.stringify({ posts: formattedPosts, total }, null, 2));
    }

    res.json({ posts: formattedPosts, total, hasMore: formattedPosts.length === limit });
  } catch (err) {
    console.error('Error fetching posts:', err);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

router.get('/:id/urls', async (req, res) => {
  try {
    const post = await postRepo.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const urls = post.platformUrls ? (post.platformUrls instanceof Map ? Object.fromEntries(post.platformUrls) : post.platformUrls) : {};
    res.json({ id: post._id.toString(), platformUrls: urls, imageUrl: post.imageUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /posts/:id/analytics - Fetch and cache analytics for a post */
router.post('/:id/analytics', async (req, res) => {
  try {
    const post = await postRepo.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const { fetchPostAnalytics } = await import('../services/analytics.service.js');
    const analytics = await fetchPostAnalytics(post, req.user._id);
    res.json({ analytics });
  } catch (err) {
    console.error('Post analytics fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Diagnostic endpoint for Instagram
router.get('/debug/instagram', async (req, res) => {
  try {
    const integration = await integrationRepo.findOne({
      userId: req.user._id,
      platform: 'instagram'
    });

    if (!integration) {
      return res.json({ connected: false, error: 'Instagram not connected' });
    }

    // Try to verify the token works
    let tokenValid = false;
    let accountInfo = null;
    let error = null;

    try {
      const response = await axios.get(
        `https://graph.instagram.com/v18.0/${integration.platformUserId}`,
        {
          params: {
            fields: 'username,name,biography,website,profile_picture_url',
            access_token: integration.accessToken,
          },
        }
      );
      tokenValid = true;
      accountInfo = response.data;
    } catch (e) {
      error = e.response?.data?.error || e.message;
    }

    res.json({
      connected: true,
      platformUserId: integration.platformUserId,
      platformUsername: integration.platformUsername,
      hasAccessToken: !!integration.accessToken,
      tokenExpiresAt: integration.tokenExpiresAt,
      isActive: integration.isActive,
      tokenValid,
      accountInfo,
      error,
      troubleshooting: tokenValid
        ? 'Token is valid. Check server logs for API response details when posting.'
        : 'Token is invalid or expired. Try re-connecting your Instagram account.'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Temporary diagnostic endpoint: accept a pasted token and run debug checks
// POST /posts/debug/instagram/token
// Body: { token: string, igUserId?: string, pageId?: string }
router.post('/debug/instagram/token', async (req, res) => {
  try {
    const { token, igUserId, pageId } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token is required in the request body' });

    const appId = config.instagram.appId;
    const appSecret = config.instagram.appSecret;

    const results = {};

    // 1) debug_token
    try {
      const debug = await axios.get('https://graph.facebook.com/debug_token', {
        params: { input_token: token, access_token: `${appId}|${appSecret}` },
      });
      results.debug_token = debug.data;
    } catch (e) {
      results.debug_token = { error: e.response?.data || e.message };
    }

    // 2) IG node (if igUserId provided)
    if (igUserId) {
      try {
        const igNode = await axios.get(`https://graph.facebook.com/v18.0/${igUserId}`, {
          params: { fields: 'id,username,account_type,media_count', access_token: token },
        });
        results.ig_node = igNode.data;
      } catch (e) {
        results.ig_node = { error: e.response?.data || e.message };
      }
    }

    // 3) Page -> IG link (if pageId provided)
    if (pageId) {
      try {
        const pageResp = await axios.get(`https://graph.facebook.com/v18.0/${pageId}`, {
          params: { fields: 'instagram_business_account', access_token: token },
        });
        results.page = pageResp.data;
      } catch (e) {
        results.page = { error: e.response?.data || e.message };
      }
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  const { content, scheduleAt, visibility = 'PUBLIC', platforms = [] } = req.body || {};
  console.log(req.body);
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'content is required' });
  }
  const trimmed = content.trim();
  if (!trimmed) return res.status(400).json({ error: 'content cannot be empty' });

  const postNow = !scheduleAt;
  if (postNow) {
    // Get active integrations
    const integrations = await integrationRepo.find({
      userId: req.user._id,
      isActive: true
    });

    const activeIntegrations = integrations.filter(i => platforms.length === 0 || platforms.includes(i.platform));

    if (activeIntegrations.length === 0) {
      return res.status(400).json({
        error: 'No active integrations found. Please connect at least one platform.',
      });
    }

    const results = [];
    const errors = [];

    // Post to each integration
    for (const integration of activeIntegrations) {
      try {
        let result;

        switch (integration.platform) {
          case 'linkedin':
            const allowed = await canMakeLinkedInCall(req.user._id);
            if (!allowed) {
              errors.push({ platform: 'linkedin', error: 'Daily LinkedIn post limit reached' });
              continue;
            }
            const authorUrn = buildAuthorUrn(integration.platformUserId);
            if (!authorUrn) {
              errors.push({ platform: 'linkedin', error: 'Invalid LinkedIn account' });
              continue;
            }

            if (req.body.imageUrl) {
              // Image post - resolve relative URL to absolute for LinkedIn to fetch
              const resolvedImg = resolveImageUrl(req.body.imageUrl);
              if (resolvedImg.startsWith('/') || resolvedImg.includes('localhost') || resolvedImg.includes('127.0.0.1')) {
                errors.push({ platform: 'linkedin', error: 'Image URL must be public. Set API_PUBLIC_URL in .env (e.g. ngrok for local)' });
                continue;
              }
              result = await createLinkedInImagePost(
                integration.accessToken,
                authorUrn,
                trimmed,
                resolvedImg,
                visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC'
              );
            } else {
              // Text post
              const payload = {
                author: authorUrn,
                commentary: trimmed,
                visibility: visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC',
              };
              result = await createLinkedInPost(integration.accessToken, payload);
            }

            if (!result.error) {
              await incrementLinkedInUsage(req.user._id);
            }
            break;

          case 'facebook':
            if (!integration.facebookPageId || !integration.facebookPageAccessToken) {
              errors.push({ platform: 'facebook', error: 'No Facebook page selected' });
              continue;
            }
            result = await createFacebookPost(
              integration.facebookPageAccessToken,
              integration.facebookPageId,
              trimmed
            );
            break;

          case 'twitter':
            if (!integration.accessToken) {
              errors.push({ platform: 'twitter', error: 'Twitter credentials missing' });
              continue;
            }
            if (trimmed.length > 280) {
              errors.push({ platform: 'twitter', error: 'Post exceeds 280 characters' });
              continue;
            }
            // Refresh token if expired or on Unauthorized (OAuth 2.0 tokens expire in 2h)
            let twitterToken = integration.accessToken;
            const isExpired = integration.tokenExpiresAt && new Date(integration.tokenExpiresAt) < new Date(Date.now() + 5 * 60 * 1000);
            if (isExpired && integration.refreshToken) {
              const refreshed = await refreshTwitterToken(integration.refreshToken);
              if (refreshed.error) {
                errors.push({ platform: 'twitter', error: 'Token expired. Please reconnect Twitter in Integrations.' });
                continue;
              }
              twitterToken = refreshed.access_token;
              await integrationRepo.findOneAndUpdate(
                { userId: req.user._id, platform: 'twitter' },
                {
                  accessToken: refreshed.access_token,
                  refreshToken: refreshed.refresh_token || integration.refreshToken,
                  tokenExpiresAt: new Date(Date.now() + (refreshed.expires_in || 7200) * 1000),
                },
                { upsert: false, new: true }
              );
            }
            result = await createTwitterPost(twitterToken, trimmed);
            // If Unauthorized and we have refresh token, try refresh + retry (handles integrations without tokenExpiresAt)
            if (result.error && (result.error.includes('Unauthorized') || result.error.includes('401')) && integration.refreshToken && !isExpired) {
              const refreshed = await refreshTwitterToken(integration.refreshToken);
              if (!refreshed.error) {
                twitterToken = refreshed.access_token;
                await integrationRepo.findOneAndUpdate(
                  { userId: req.user._id, platform: 'twitter' },
                  {
                    accessToken: refreshed.access_token,
                    refreshToken: refreshed.refresh_token || integration.refreshToken,
                    tokenExpiresAt: new Date(Date.now() + (refreshed.expires_in || 7200) * 1000),
                  },
                  { upsert: false, new: true }
                );
                result = await createTwitterPost(twitterToken, trimmed);
              }
            }
            if (result.error && (result.error.includes('Unauthorized') || result.error.includes('401'))) {
              result.error = 'Twitter session expired. Please disconnect and reconnect Twitter in Integrations.';
            }
            break;

          case 'threads':
            if (!integration.accessToken || !integration.platformUserId) {
              errors.push({ platform: 'threads', error: 'Threads credentials missing' });
              continue;
            }
            if (trimmed.length > 500) {
              errors.push({ platform: 'threads', error: 'Post exceeds 500 characters' });
              continue;
            }
            result = await createThreadsPost(
              integration.accessToken,
              integration.platformUserId,
              trimmed
            );
            await integrationRepo.updateLastUsed(integration._id, new Date());
            break;

          case 'instagram':
            const igAccountId = integration.instagramBusinessAccountId || integration.platformUserId;
            const igAccessToken = integration.instagramPageAccessToken || integration.accessToken;
            // Direct Login tokens (Instagram Business Login) use graph.instagram.com
            // Facebook Page-linked tokens use graph.facebook.com
            const igBaseUrl = integration.instagramPageAccessToken
              ? 'https://graph.facebook.com/v18.0'
              : 'https://graph.instagram.com/v18.0';

            if (!igAccountId || !igAccessToken) {
              errors.push({ platform: 'instagram', error: 'Instagram account not fully configured' });
              continue;
            }
            if (trimmed.length > 2200) {
              errors.push({ platform: 'instagram', error: 'Caption exceeds 2200 characters' });
              continue;
            }
            // Instagram requires an image for feed posts
            const imageUrlFromMain = req.body?.imageUrl;
            if (!imageUrlFromMain) {
              errors.push({ platform: 'instagram', error: 'Instagram requires an image URL for feed posts' });
              continue;
            }
            const resolvedIgImg = resolveImageUrl(imageUrlFromMain);
            if (resolvedIgImg.startsWith('/') || resolvedIgImg.includes('localhost') || resolvedIgImg.includes('127.0.0.1')) {
              errors.push({ platform: 'instagram', error: 'Image URL must be public. Set API_PUBLIC_URL in .env (e.g. ngrok for local)' });
              continue;
            }
            result = await createInstagramPost(
              igAccessToken,
              igAccountId,
              trimmed,
              resolvedIgImg,
              igBaseUrl
            );
            await integrationRepo.updateLastUsed(integration._id, new Date());
            break;

          default:
            errors.push({ platform: integration.platform, error: 'Unsupported platform' });
            continue;
        }

        if (result.error) {
          let errMsg = result.error;
          if (integration.platform === 'threads' && (errMsg.includes('expired') || errMsg.includes('Session has expired'))) {
            errMsg = 'Threads session expired. Please reconnect Threads in Integrations.';
          }
          errors.push({ platform: integration.platform, error: errMsg });
        } else {
          results.push({
            platform: integration.platform,
            id: result.id,
            url: result.url,
          });
        }
      } catch (err) {
        let errMsg = err.message;
        if (integration.platform === 'threads' && (errMsg.includes('expired') || errMsg.includes('Session has expired'))) {
          errMsg = 'Threads session expired. Please reconnect Threads in Integrations.';
        }
        errors.push({ platform: integration.platform, error: errMsg });
      }
    }

    if (results.length === 0) {
      return res.status(400).json({
        error: 'Failed to post to any platform',
        errors,
      });
    }

    // Create post record
    const postRecord = {
      userId: req.user._id,
      content: trimmed,
      visibility,
      mediaType: req.body.mediaType || 'text',
      imageUrl: req.body.imageUrl,
      videoUrl: req.body.videoUrl,
      mediaItems: req.body.mediaItems,
      status: 'published',
      publishedAt: new Date(),
      platforms: results.map(r => r.platform),
      platformIds: results.reduce((acc, r) => ({ ...acc, [r.platform]: r.id }), {}),
      platformUrls: results.reduce((acc, r) => ({ ...acc, [r.platform]: r.url }), {}),
    };

    const newPost = await postRepo.create(postRecord);
    const postObj = { id: newPost._id.toString(), ...newPost };

    // Store LinkedIn posts in Firebase Storage for backup
    if (postRecord.platforms?.includes('linkedin')) {
      storeLinkedInPostInFirebase(req.user._id.toString(), newPost).catch(() => {});
    }

    postObj.results = results;
    if (errors.length > 0) {
      postObj.errors = errors;
    }

    return res.status(201).json(postObj);
  }

  const scheduledAtDate = new Date(scheduleAt);
  if (Number.isNaN(scheduledAtDate.getTime())) {
    return res.status(400).json({ error: 'Invalid scheduleAt date' });
  }
  if (scheduledAtDate <= new Date()) {
    return res.status(400).json({ error: 'scheduleAt must be in the future' });
  }

  const postRecord = {
    userId: req.user._id,
    content: trimmed,
    visibility,
    mediaType: req.body.mediaType || 'text',
    imageUrl: req.body.imageUrl,
    videoUrl: req.body.videoUrl,
    mediaItems: req.body.mediaItems,
    platforms: Array.isArray(platforms) && platforms.length > 0 ? platforms : [],
    status: 'scheduled',
    scheduledAt: scheduledAtDate,
  };

  const newPost = await postRepo.create(postRecord);
  res.status(201).json(formatPostForResponse(newPost));
});

/** PATCH /posts/:id/reschedule - Reschedule a scheduled post */
router.patch('/:id/reschedule', async (req, res) => {
  try {
    const post = await postRepo.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status !== 'scheduled') {
      return res.status(400).json({ error: 'Only scheduled posts can be rescheduled' });
    }
    const { scheduledTime } = req.body || {};
    if (!scheduledTime) return res.status(400).json({ error: 'scheduledTime is required' });
    const d = new Date(scheduledTime);
    if (Number.isNaN(d.getTime()) || d <= new Date()) {
      return res.status(400).json({ error: 'scheduledTime must be a valid future date' });
    }
    const updated = await postRepo.findByIdAndUpdate(post._id, { scheduledAt: d });
    res.json(formatPostForResponse(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const post = await postRepo.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.status !== 'draft' && post.status !== 'scheduled') {
      return res.status(400).json({ error: 'Only draft or scheduled posts can be updated' });
    }

    const { content, scheduleAt, visibility } = req.body || {};
    const update = {};
    if (content !== undefined) update.content = String(content).trim();
    if (visibility !== undefined) update.visibility = visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC';
    if (scheduleAt !== undefined) {
      const d = new Date(scheduleAt);
      if (!Number.isNaN(d.getTime())) update.scheduledAt = d;
    }

    const updated = await postRepo.findByIdAndUpdate(post._id, update);
    res.json(formatPostForResponse(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const post = await postRepo.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /posts/image - Publish image to Instagram
router.post('/image', async (req, res) => {
  try {
    const { content, imageUrl, platforms } = req.body;
    const userId = req.user._id;

    if (!imageUrl || !platforms || platforms.length === 0) {
      return res.status(400).json({ error: 'imageUrl and platforms are required' });
    }

    // Validate that imageUrl is publicly accessible (LinkedIn & Instagram require fetchable URLs)
    if (imageUrl.startsWith('data:')) {
      return res.status(400).json({
        error: 'Data URLs are not supported. Use an uploaded image URL instead.'
      });
    }

    // Convert relative URLs to absolute - Instagram/LinkedIn require publicly reachable URLs
    let resolvedImageUrl = imageUrl;
    if (imageUrl.startsWith('/') && (imageUrl.startsWith('/uploads') || imageUrl.startsWith('/api/'))) {
      const base = (config.apiPublicUrl || config.uploadBaseUrl || '').trim();
      if (base && (base.startsWith('http://') || base.startsWith('https://'))) {
        resolvedImageUrl = `${base.replace(/\/$/, '')}${imageUrl}`;
      } else {
        return res.status(400).json({
          error: 'LinkedIn and Instagram need a public image URL. Add API_PUBLIC_URL to .env. Local dev: run "ngrok http 4000", then set API_PUBLIC_URL=https://your-ngrok-url.ngrok-free.app'
        });
      }
    } else if (imageUrl.includes('localhost') || imageUrl.includes('127.0.0.1')) {
      return res.status(400).json({
        error: 'LinkedIn and Instagram cannot fetch from localhost. Set API_PUBLIC_URL to a public URL (e.g. ngrok) in .env'
      });
    }

    const results = {};

    // Handle Instagram posting
    if (platforms.includes('instagram')) {
      try {
        const integration = await integrationRepo.findOne({
          userId: req.user._id,
          platform: 'instagram',
          isActive: true
        });

        if (!integration) {
          results.instagram = { success: false, error: 'Instagram not connected' };
        } else {
          // Check rate limit
          const limit = await getInstagramPublishingLimit(integration.platformUserId, integration.accessToken);
          if (limit.quota_used >= 100) {
            results.instagram = { success: false, error: 'Rate limit exceeded (100 posts per 24 hours)' };
          } else {
            // Determine baseUrl
            const igBaseUrl = integration.instagramPageAccessToken
              ? 'https://graph.facebook.com/v18.0'
              : 'https://graph.instagram.com/v18.0';

            // Create media container (resolvedImageUrl is absolute for Instagram to fetch)
            const container = await createInstagramMediaContainer(
              integration.platformUserId,
              integration.accessToken,
              {
                image_url: resolvedImageUrl,
                caption: content || '',
                media_type: 'IMAGE'
              },
              igBaseUrl
            );

            console.log('Container response:', { container, error: container?.error });
            if (!container || !container.id) {
              results.instagram = { success: false, error: container?.error || 'Failed to create media container' };
            } else {
              // Wait for media to be ready before publishing
              const readyResult = await waitForMediaReady(container.id, integration.accessToken, igBaseUrl);
              if (!readyResult.ready) {
                results.instagram = { success: false, error: readyResult.error };
              } else {
                // Publish media
                const published = await publishInstagramMedia(
                  integration.platformUserId,
                  integration.accessToken,
                  container.id,
                  igBaseUrl
                );

                console.log('Publish response:', { published, error: published?.error });
                if (published && published.media_id) {
                  // Save to database
                  const postRecord = {
                    userId: req.user._id,
                    content: (content && content.trim()) ? content.trim() : ' ',
                    platforms: ['instagram'],
                    mediaType: 'image',
                    imageUrl,
                    platformIds: { instagram: published.media_id },
                    status: 'published',
                    publishedAt: new Date(),
                  };
                  await postRepo.create(postRecord);

                  await integrationRepo.updateLastUsed(integration._id, new Date());

                  results.instagram = { success: true, postId: published.media_id };
                } else {
                  results.instagram = { success: false, error: published?.error || 'Failed to publish media' };
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('Instagram image publishing error:', error.message);
        results.instagram = { success: false, error: error.message };
      }
    }

    // Handle LinkedIn posting
    if (platforms.includes('linkedin')) {
      try {
        const integration = await integrationRepo.findOne({
          userId: req.user._id,
          platform: 'linkedin',
          isActive: true
        });

        if (!integration) {
          results.linkedin = { success: false, error: 'LinkedIn not connected' };
        } else {
          const authorUrn = buildAuthorUrn(integration.platformUserId);
          const result = await createLinkedInImagePost(
            integration.accessToken,
            authorUrn,
            content || '',
            resolvedImageUrl,
            'PUBLIC'
          );

          if (result.error) {
            results.linkedin = { success: false, error: result.error };
          } else {
            results.linkedin = { success: true, postId: result.postUrn };
            await incrementLinkedInUsage(req.user._id);

            // Save post record (avoiding duplicates if multiple platforms)
            const existing = await postRepo.findOne({ userId: req.user._id, content, imageUrl, status: 'published' });
            let postRecord;
            if (!existing) {
              postRecord = await postRepo.create({
                userId: req.user._id,
                content: (content && content.trim()) ? content.trim() : ' ',
                platforms: ['linkedin'],
                mediaType: 'image',
                imageUrl,
                platformIds: { linkedin: result.postUrn },
                status: 'published',
                publishedAt: new Date(),
              });
            } else {
              const platforms = [...(existing.platforms || []), 'linkedin'];
              const platformIds = { ...(existing.platformIds || {}), linkedin: result.postUrn };
              postRecord = await postRepo.findByIdAndUpdate(existing._id, { platforms, platformIds });
            }
            storeLinkedInPostInFirebase(req.user._id.toString(), postRecord).catch(() => {});
          }
        }
      } catch (error) {
        console.error('LinkedIn image publishing error:', error.message);
        results.linkedin = { success: false, error: error.message };
      }
    }

    // Handle Threads posting
    if (platforms.includes('threads')) {
      try {
        const integration = await integrationRepo.findOne({
          userId: req.user._id,
          platform: 'threads',
          isActive: true
        });

        if (!integration) {
          results.threads = { success: false, error: 'Threads not connected' };
        } else if (!integration.platformUserId) {
          results.threads = { success: false, error: 'Threads user ID missing' };
        } else {
          const result = await createThreadsPost(
            integration.accessToken,
            integration.platformUserId,
            content || '',
            { image_url: resolvedImageUrl }
          );

          if (result.error) {
            const errMsg = (result.error.includes('expired') || result.error.includes('Session has expired'))
              ? 'Threads session expired. Please reconnect Threads in Integrations.'
              : result.error;
            results.threads = { success: false, error: errMsg };
          } else {
            results.threads = { success: true, postId: result.id, url: result.url };
            await integrationRepo.updateLastUsed(integration._id, new Date());

            const existing = await postRepo.findOne({ userId: req.user._id, content, imageUrl, status: 'published' });
            if (!existing) {
              await postRepo.create({
                userId: req.user._id,
                content: (content && content.trim()) ? content.trim() : ' ',
                platforms: ['threads'],
                mediaType: 'image',
                imageUrl,
                platformIds: { threads: result.id },
                status: 'published',
                publishedAt: new Date(),
              });
            } else {
              const platforms = [...(existing.platforms || []), 'threads'];
              const platformIds = { ...(existing.platformIds || {}), threads: result.id };
              await postRepo.findByIdAndUpdate(existing._id, { platforms, platformIds });
            }
          }
        }
      } catch (error) {
        console.error('Threads image publishing error:', error.message);
        const errMsg = (error.message.includes('expired') || error.message.includes('Session has expired'))
          ? 'Threads session expired. Please reconnect Threads in Integrations.'
          : error.message;
        results.threads = { success: false, error: errMsg };
      }
    }

    // Handle Facebook image posting
    if (platforms.includes('facebook')) {
      try {
        const integration = await integrationRepo.findOne({
          userId: req.user._id,
          platform: 'facebook',
          isActive: true
        });

        if (!integration) {
          results.facebook = { success: false, error: 'Facebook not connected' };
        } else if (!integration.facebookPageId || !integration.facebookPageAccessToken) {
          results.facebook = { success: false, error: 'No Facebook page selected' };
        } else {
          const result = await createFacebookPhotoPost(
            integration.facebookPageAccessToken,
            integration.facebookPageId,
            content || '',
            resolvedImageUrl
          );

          if (result.error) {
            results.facebook = { success: false, error: result.error };
          } else {
            results.facebook = { success: true, postId: result.id, url: result.url };
            await integrationRepo.updateLastUsed(integration._id, new Date());
            const existing = await postRepo.findOne({ userId: req.user._id, content, imageUrl, status: 'published' });
            if (existing) {
              if (!existing.platforms?.includes('facebook')) {
                const platforms = [...(existing.platforms || []), 'facebook'];
                const platformIds = { ...(existing.platformIds || {}), facebook: result.id };
                await postRepo.findByIdAndUpdate(existing._id, { platforms, platformIds });
              }
            } else {
              await postRepo.create({
                userId: req.user._id,
                content: (content && content.trim()) ? content.trim() : ' ',
                platforms: ['facebook'],
                mediaType: 'image',
                imageUrl,
                platformIds: { facebook: result.id },
                status: 'published',
                publishedAt: new Date(),
              });
            }
          }
        }
      } catch (error) {
        console.error('Facebook image publishing error:', error.message);
        results.facebook = { success: false, error: error.message };
      }
    }

    // Handle Twitter - upload image and post with media
    if (platforms.includes('twitter')) {
      try {
        const integration = await integrationRepo.findOne({
          userId: req.user._id,
          platform: 'twitter',
          isActive: true
        });
        if (!integration) {
          results.twitter = { success: false, error: 'Twitter not connected' };
        } else {
          let twitterToken = integration.accessToken;
          const isExpired = integration.tokenExpiresAt && new Date(integration.tokenExpiresAt) < new Date(Date.now() + 5 * 60 * 1000);
          if (isExpired && integration.refreshToken) {
            const refreshed = await refreshTwitterToken(integration.refreshToken);
            if (!refreshed.error) {
              twitterToken = refreshed.access_token;
              await integrationRepo.findOneAndUpdate(
                { userId: req.user._id, platform: 'twitter' },
                {
                  accessToken: refreshed.access_token,
                  refreshToken: refreshed.refresh_token || integration.refreshToken,
                  tokenExpiresAt: new Date(Date.now() + (refreshed.expires_in || 7200) * 1000),
                },
                { upsert: false, new: true }
              );
            }
          }
          let mediaIds = [];
          // Use OAuth 2.0 only for image upload (chunked flow) - no OAuth 1.0a needed
          const uploadResult = await uploadTwitterMedia(twitterToken, resolvedImageUrl, {});
          if (!uploadResult.error) mediaIds = [uploadResult.mediaId];
          else if (uploadResult.error) console.log('Twitter media upload failed:', uploadResult.error);
          const result = await createTwitterPost(twitterToken, content || ' ', mediaIds);
          if (result.error) {
            results.twitter = { success: false, error: result.error };
          } else {
            console.log('Twitter post success:', { postId: result.id, url: result.url });
            results.twitter = {
              success: true,
              postId: result.id,
              url: result.url,
              ...(uploadResult.error && { mediaWarning: uploadResult.error }),
            };
            const existing = await postRepo.findOne({ userId: req.user._id, content, imageUrl, status: 'published' });
            if (existing) {
              if (!existing.platforms?.includes('twitter')) {
                const platforms = [...(existing.platforms || []), 'twitter'];
                const platformIds = { ...(existing.platformIds || {}), twitter: result.id };
                await postRepo.findByIdAndUpdate(existing._id, { platforms, platformIds });
              }
            } else {
              await postRepo.create({
                userId: req.user._id,
                content: (content && content.trim()) ? content.trim() : ' ',
                platforms: ['twitter'],
                mediaType: 'image',
                imageUrl,
                platformIds: { twitter: result.id },
                status: 'published',
                publishedAt: new Date(),
              });
            }
          }
        }
      } catch (error) {
        results.twitter = { success: false, error: error.message };
      }
    }

    // Build platformUrls for frontend (links to view posts)
    const platformUrls = {};
    if (results.linkedin?.success && results.linkedin.postId) platformUrls.linkedin = `https://www.linkedin.com/feed/update/${results.linkedin.postId}`;
    if (results.instagram?.success && results.instagram.postId) platformUrls.instagram = `https://www.instagram.com/p/${results.instagram.postId}`;
    if (results.threads?.url) platformUrls.threads = results.threads.url;
    if (results.facebook?.url) platformUrls.facebook = results.facebook.url;
    if (results.twitter?.url) platformUrls.twitter = results.twitter.url;

    res.json({ ...results, platformUrls });
  } catch (error) {
    console.error('Image publishing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /posts/video - Publish video to Instagram
router.post('/video', async (req, res) => {
  try {
    const { content, videoUrl, platforms, mediaType } = req.body;
    const userId = req.user._id;

    if (!videoUrl || !platforms || platforms.length === 0) {
      return res.status(400).json({ error: 'videoUrl and platforms are required' });
    }

    const results = {};

    // Handle Instagram posting
    if (platforms.includes('instagram')) {
      try {
        const integration = await integrationRepo.findOne({
          userId: req.user._id,
          platform: 'instagram',
          isActive: true
        });

        if (!integration) {
          results.instagram = { success: false, error: 'Instagram not connected' };
        } else {
          // Check rate limit
          const limit = await getInstagramPublishingLimit(integration.platformUserId, integration.accessToken);
          if (limit.quota_used >= 100) {
            results.instagram = { success: false, error: 'Rate limit exceeded (100 posts per 24 hours)' };
          } else {
            // Determine media type (VIDEO or REELS)
            const instagramMediaType = mediaType || 'VIDEO';

            // Determine baseUrl
            const igBaseUrl = integration.instagramPageAccessToken
              ? 'https://graph.facebook.com/v18.0'
              : 'https://graph.instagram.com/v18.0';

            // Create media container
            const container = await createInstagramMediaContainer(
              integration.platformUserId,
              integration.accessToken,
              {
                video_url: videoUrl,
                caption: content || '',
                media_type: instagramMediaType
              },
              igBaseUrl
            );

            if (!container || !container.id) {
              results.instagram = { success: false, error: 'Failed to create media container' };
            } else {
              // Wait for media to be ready
              const readyResult = await waitForMediaReady(container.id, integration.accessToken, igBaseUrl);
              if (!readyResult.ready) {
                results.instagram = { success: false, error: readyResult.error };
              } else {
                // Publish media
                const published = await publishInstagramMedia(
                  integration.platformUserId,
                  integration.accessToken,
                  container.id,
                  igBaseUrl
                );

                if (published && published.media_id) {
                  // Save to database
                  const postRecord = {
                    userId: req.user._id,
                    content: (content && content.trim()) ? content.trim() : ' ',
                    platforms: ['instagram'],
                    mediaType: mediaType || 'video',
                    videoUrl,
                    platformIds: { instagram: published.media_id },
                    status: 'published',
                    publishedAt: new Date(),
                  };
                  await postRepo.create(postRecord);

                  await integrationRepo.updateLastUsed(integration._id, new Date());

                  results.instagram = { success: true, postId: published.media_id };
                } else {
                  results.instagram = { success: false, error: 'Failed to publish media' };
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('Instagram video publishing error:', error.message);
        results.instagram = { success: false, error: error.message };
      }
    }

    res.json(results);
  } catch (error) {
    console.error('Video publishing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /posts/carousel - Publish carousel to Instagram
router.post('/carousel', async (req, res) => {
  try {
    const { content, mediaItems, platforms } = req.body;
    const userId = req.user._id;

    if (!mediaItems || !Array.isArray(mediaItems) || mediaItems.length < 2 || !platforms || platforms.length === 0) {
      return res.status(400).json({ error: 'At least 2 mediaItems and platforms are required' });
    }

    const results = {};

    // Handle Instagram posting
    if (platforms.includes('instagram')) {
      try {
        const integration = await integrationRepo.findOne({
          userId: req.user._id,
          platform: 'instagram',
          isActive: true
        });

        if (!integration) {
          results.instagram = { success: false, error: 'Instagram not connected' };
        } else {
          // Check rate limit
          const limit = await getInstagramPublishingLimit(integration.platformUserId, integration.accessToken);
          if (limit.quota_used >= 100) {
            results.instagram = { success: false, error: 'Rate limit exceeded (100 posts per 24 hours)' };
          } else {
            // Determine baseUrl
            const igBaseUrl = integration.instagramPageAccessToken
              ? 'https://graph.facebook.com/v18.0'
              : 'https://graph.instagram.com/v18.0';

            // Create containers for each media item (resolve relative URLs for Instagram)
            const children = [];
            for (const media of mediaItems) {
              const mediaUrl = media.imageUrl || media.videoUrl;
              const resolvedMediaUrl = resolveImageUrl(mediaUrl);
              if (mediaUrl && resolvedMediaUrl.startsWith('/')) {
                results.instagram = { success: false, error: 'Carousel media URLs must be absolute. Set API_PUBLIC_URL in .env' };
                break;
              }
              const container = await createInstagramMediaContainer(
                integration.platformUserId,
                integration.accessToken,
                {
                  image_url: media.imageUrl ? resolvedMediaUrl : undefined,
                  video_url: media.videoUrl ? resolveImageUrl(media.videoUrl) : undefined,
                  media_type: media.type || 'IMAGE'
                },
                igBaseUrl
              );

              if (container && container.id) {
                children.push(container.id);
              }
            }

            if (children.length === 0) {
              results.instagram = { success: false, error: 'Failed to create media containers' };
            } else {
              // Create carousel container
              const carousel = await createInstagramMediaContainer(
                integration.platformUserId,
                integration.accessToken,
                {
                  media_type: 'CAROUSEL',
                  children: children,
                  caption: content || ''
                },
                igBaseUrl
              );

              if (!carousel || !carousel.id) {
                results.instagram = { success: false, error: 'Failed to create carousel container' };
              } else {
                // Wait for media to be ready
                const readyResult = await waitForMediaReady(carousel.id, integration.accessToken, igBaseUrl);
                if (!readyResult.ready) {
                  results.instagram = { success: false, error: readyResult.error };
                } else {
                  // Publish carousel
                  const published = await publishInstagramMedia(
                    integration.platformUserId,
                    integration.accessToken,
                    carousel.id,
                    igBaseUrl
                  );

                  if (published && published.media_id) {
                    // Save to database
                    const postRecord = {
                      userId: req.user._id,
                      content: (content && content.trim()) ? content.trim() : ' ',
                      platforms: ['instagram'],
                      mediaType: 'carousel',
                      mediaItems,
                      platformIds: { instagram: published.media_id },
                      status: 'published',
                      publishedAt: new Date(),
                    };
                    await postRepo.create(postRecord);

                    await integrationRepo.updateLastUsed(integration._id, new Date());

                    results.instagram = { success: true, postId: published.media_id };
                  } else {
                    results.instagram = { success: false, error: 'Failed to publish carousel' };
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('Instagram carousel publishing error:', error.message);
        results.instagram = { success: false, error: error.message };
      }
    }

    res.json(results);
  } catch (error) {
    console.error('Carousel publishing error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
