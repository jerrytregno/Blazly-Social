import cron from 'node-cron';
import { Post } from './models/Post.js';
import { User } from './models/User.js';
import { Integration } from './models/Integration.js';
import { pollAndGenerateInsights } from './services/trendEngine.service.js';
import { canMakeLinkedInCall, incrementLinkedInUsage } from './services/rateLimit.js';
import { createPost as createLinkedInPost, createPostWithImage as createLinkedInImagePost, buildAuthorUrn } from './services/linkedin.js';
import { createPost as createFacebookPost } from './services/facebook.js';
import { createPost as createTwitterPost } from './services/twitter.js';
import { createPost as createThreadsPost } from './services/threads.js';
import { createPost as createInstagramPost, createInstagramMediaContainer, publishInstagramMedia, waitForMediaReady } from './services/instagram.js';
import { resolveImageUrl } from './utils/imageUrl.js';

async function processScheduledPosts() {
  const now = new Date();
  const due = await Post.find({
    status: 'scheduled',
    scheduledAt: { $lte: now },
  })
    .limit(10)
    .exec();

  for (const post of due) {
    console.log(`Processing scheduled post: ${post._id}`);
    const results = [];
    const errors = [];
    const platformIds = {};
    const platformUrls = {};

    // Get integrations for this user
    const integrations = await Integration.find({
      userId: post.userId,
      isActive: true
    });

    for (const platform of post.platforms || []) {
      const integration = integrations.find(i => i.platform === platform);
      if (!integration) {
        errors.push({ platform, error: 'Integration not found or inactive' });
        continue;
      }

      try {
        let result = { error: null };
        const trimmed = post.content.trim();

        switch (platform) {
          case 'linkedin':
            const allowed = await canMakeLinkedInCall(post.userId);
            if (!allowed) {
              errors.push({ platform: 'linkedin', error: 'Daily LinkedIn post limit reached' });
              continue;
            }
            const authorUrn = buildAuthorUrn(integration.platformUserId);
            if (!authorUrn) {
              errors.push({ platform: 'linkedin', error: 'Invalid LinkedIn account' });
              continue;
            }

            if (post.imageUrl) {
              const resolvedUrl = resolveImageUrl(post.imageUrl);
              result = await createLinkedInImagePost(
                integration.accessToken,
                authorUrn,
                trimmed,
                resolvedUrl,
                post.visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC'
              );
            } else {
              result = await createLinkedInPost(integration.accessToken, {
                author: authorUrn,
                commentary: trimmed,
                visibility: post.visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC',
              });
            }

            if (!result.error) {
              result.id = result.postUrn; // Ensure result.id is populated for the scheduler
              await incrementLinkedInUsage(post.userId);
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
            result = await createTwitterPost(
              integration.accessToken,
              trimmed
            );
            break;

          case 'threads':
            result = await createThreadsPost(
              integration.accessToken,
              integration.platformUserId,
              trimmed
            );
            break;

          case 'instagram':
            if (!post.imageUrl) {
              errors.push({ platform: 'instagram', error: 'Instagram requires an image URL' });
              continue;
            }
            const resolvedIgUrl = resolveImageUrl(post.imageUrl);
            if (resolvedIgUrl.startsWith('/')) {
              errors.push({ platform: 'instagram', error: 'Image URL must be absolute for Instagram. Set API_PUBLIC_URL in .env' });
              continue;
            }
            const igBaseUrl = integration.instagramPageAccessToken
              ? 'https://graph.facebook.com/v18.0'
              : 'https://graph.instagram.com/v18.0';

            const container = await createInstagramMediaContainer(
              integration.platformUserId,
              integration.accessToken,
              {
                image_url: resolvedIgUrl,
                caption: trimmed,
                media_type: 'IMAGE'
              },
              igBaseUrl
            );

            if (container && container.id) {
              const readyResult = await waitForMediaReady(container.id, integration.accessToken, igBaseUrl);
              if (readyResult.ready) {
                result = await publishInstagramMedia(
                  integration.platformUserId,
                  integration.accessToken,
                  container.id,
                  igBaseUrl
                );
                if (result.media_id) {
                  result.id = result.media_id;
                }
              } else {
                result = { error: readyResult.error };
              }
            } else {
              result = { error: 'Failed to create media container' };
            }
            break;
        }

        if (result.error) {
          errors.push({ platform, error: result.error });
        } else {
          results.push({ platform, id: result.id, url: result.url });
          platformIds[platform] = result.id;
          platformUrls[platform] = result.url;

          integration.lastUsedAt = new Date();
          await integration.save();
        }
      } catch (err) {
        errors.push({ platform, error: err.message });
      }
    }

    if (results.length > 0) {
      post.status = 'published';
      post.publishedAt = new Date();
      post.platformIds = platformIds;
      post.platformUrls = platformUrls;
      if (errors.length > 0) post.errors = errors;
      await post.save();
    } else {
      post.status = 'failed';
      post.errors = errors;
      await post.save();
    }
  }
}

async function processTrendPolling() {
  try {
    const users = await User.find({}).select('_id').lean();
    for (const u of users) {
      try {
        await pollAndGenerateInsights(u._id);
      } catch (e) {
        console.error(`Trend poll failed for user ${u._id}:`, e.message);
      }
    }
  } catch (err) {
    console.error('Trend polling error:', err);
  }
}

export function startScheduler() {
  cron.schedule('* * * * *', processScheduledPosts);
  console.log('Scheduler: running every minute');

  // Trend engine: poll every 30 minutes
  cron.schedule('*/30 * * * *', processTrendPolling);
  console.log('Trend engine: polling every 30 minutes');
}
