import { Router } from 'express';
import axios from 'axios';
import { config } from '../config.js';
import { Post } from '../models/Post.js';
import { Integration } from '../models/Integration.js';
import { requireAuth } from '../middleware/auth.js';
import { canMakeLinkedInCall, incrementLinkedInUsage } from '../services/rateLimit.js';
import { createPost as createLinkedInPost, createPostWithImage as createLinkedInImagePost, buildAuthorUrn, getMemberId } from '../services/linkedin.js';
import { createPost as createFacebookPost } from '../services/facebook.js';
import { createPost as createTwitterPost } from '../services/twitter.js';
import { createPost as createThreadsPost } from '../services/threads.js';
import { createPost as createInstagramPost, createInstagramMediaContainer, publishInstagramMedia, getInstagramPublishingLimit, waitForMediaReady } from '../services/instagram.js';
import { resolveImageUrl } from '../utils/imageUrl.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const limit = req.query.format ? Math.min(parseInt(req.query.limit) || 5000, 5000) : (parseInt(req.query.limit) || 10);
    const startAfter = req.query.startAfter;
    const platform = req.query.platform;
    const fromDate = req.query.fromDate;
    const toDate = req.query.toDate;
    const status = req.query.status;
    const format = req.query.format;

    let baseQuery = { userId: req.user._id };
    if (platform) baseQuery.platforms = platform;
    if (status) baseQuery.status = status;
    if (fromDate || toDate) {
      baseQuery.createdAt = {};
      if (fromDate) baseQuery.createdAt.$gte = new Date(fromDate);
      if (toDate) baseQuery.createdAt.$lte = new Date(toDate + 'T23:59:59.999Z');
    }

    let query = Post.find(baseQuery).sort({ createdAt: -1 }).limit(limit);

    if (startAfter) {
      query = Post.find({
        ...baseQuery,
        _id: { $lt: startAfter },
      })
        .sort({ createdAt: -1 })
        .limit(limit);
    }

    const posts = await query.exec();
    const total = await Post.countDocuments(baseQuery);

    const formattedPosts = posts.map(doc => ({
      id: doc._id.toString(),
      ...doc.toObject(),
    }));

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
    const post = await Post.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const urls = post.platformUrls ? Object.fromEntries(post.platformUrls) : {};
    res.json({ id: post._id.toString(), platformUrls: urls, imageUrl: post.imageUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Diagnostic endpoint for Instagram
router.get('/debug/instagram', async (req, res) => {
  try {
    const integration = await Integration.findOne({
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
    const integrations = await Integration.find({
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
              // Image post
              result = await createLinkedInImagePost(
                integration.accessToken,
                authorUrn,
                trimmed,
                req.body.imageUrl,
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
            result = await createTwitterPost(
              integration.accessToken,
              trimmed
            );
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
            // Update last used
            integration.lastUsedAt = new Date();
            await integration.save();
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
            // Check if imageUrl is provided in the request body
            const imageUrlFromMain = req.body?.imageUrl;
            if (!imageUrlFromMain) {
              errors.push({ platform: 'instagram', error: 'Instagram requires an image URL for feed posts' });
              continue;
            }
            result = await createInstagramPost(
              igAccessToken,
              igAccountId,
              trimmed,
              imageUrlFromMain,
              igBaseUrl
            );
            integration.lastUsedAt = new Date();
            await integration.save();
            break;

          default:
            errors.push({ platform: integration.platform, error: 'Unsupported platform' });
            continue;
        }

        if (result.error) {
          errors.push({ platform: integration.platform, error: result.error });
        } else {
          results.push({
            platform: integration.platform,
            id: result.id,
            url: result.url,
          });
        }
      } catch (err) {
        errors.push({ platform: integration.platform, error: err.message });
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

    const newPost = await Post.create(postRecord);
    const postObj = { id: newPost._id.toString(), ...newPost.toObject() };

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

  const newPost = await Post.create(postRecord);
  res.status(201).json({ id: newPost._id.toString(), ...newPost.toObject() });
});

/** PATCH /posts/:id/reschedule - Reschedule a scheduled post */
router.patch('/:id/reschedule', async (req, res) => {
  try {
    const post = await Post.findOne({
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
    post.scheduledAt = d;
    await post.save();
    res.json({ id: post._id.toString(), ...post.toObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const post = await Post.findOne({
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

    if (content !== undefined) post.content = String(content).trim();
    if (visibility !== undefined) post.visibility = visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC';
    if (scheduleAt !== undefined) {
      const d = new Date(scheduleAt);
      if (!Number.isNaN(d.getTime())) post.scheduledAt = d;
    }

    await post.save();
    res.json({ id: post._id.toString(), ...post.toObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const post = await Post.findOneAndDelete({
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
          error: 'LinkedIn and Instagram need a public image URL. Add API_PUBLIC_URL to backend/.env. Local dev: run "ngrok http 4000", then set API_PUBLIC_URL=https://your-ngrok-url.ngrok-free.app'
        });
      }
    } else if (imageUrl.includes('localhost') || imageUrl.includes('127.0.0.1')) {
      return res.status(400).json({
        error: 'LinkedIn and Instagram cannot fetch from localhost. Set API_PUBLIC_URL to a public URL (e.g. ngrok) in backend/.env'
      });
    }

    const results = {};

    // Handle Instagram posting
    if (platforms.includes('instagram')) {
      try {
        const integration = await Integration.findOne({
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
                    content: content || '',
                    platforms: ['instagram'],
                    mediaType: 'image',
                    imageUrl,
                    platformIds: { instagram: published.media_id },
                    status: 'published',
                    publishedAt: new Date(),
                  };
                  await Post.create(postRecord);

                  // Update integration lastUsedAt
                  integration.lastUsedAt = new Date();
                  await integration.save();

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
        const integration = await Integration.findOne({
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
            const existing = await Post.findOne({ userId: req.user._id, content, imageUrl, status: 'published' });
            if (!existing) {
              await Post.create({
                userId: req.user._id,
                content: content || '',
                platforms: ['linkedin'],
                mediaType: 'image',
                imageUrl,
                platformIds: { linkedin: result.postUrn },
                status: 'published',
                publishedAt: new Date(),
              });
            } else {
              existing.platforms.push('linkedin');
              existing.platformIds.set('linkedin', result.postUrn);
              await existing.save();
            }
          }
        }
      } catch (error) {
        console.error('LinkedIn image publishing error:', error.message);
        results.linkedin = { success: false, error: error.message };
      }
    }

    res.json(results);
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
        const integration = await Integration.findOne({
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
                    content: content || '',
                    platforms: ['instagram'],
                    mediaType: mediaType || 'video',
                    videoUrl,
                    platformIds: { instagram: published.media_id },
                    status: 'published',
                    publishedAt: new Date(),
                  };
                  await Post.create(postRecord);

                  // Update integration lastUsedAt
                  integration.lastUsedAt = new Date();
                  await integration.save();

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
        const integration = await Integration.findOne({
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
                      content: content || '',
                      platforms: ['instagram'],
                      mediaType: 'carousel',
                      mediaItems,
                      platformIds: { instagram: published.media_id },
                      status: 'published',
                      publishedAt: new Date(),
                    };
                    await Post.create(postRecord);

                    // Update integration lastUsedAt
                    integration.lastUsedAt = new Date();
                    await integration.save();

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
