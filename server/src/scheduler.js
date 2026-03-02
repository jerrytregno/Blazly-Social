import cron from 'node-cron';
import * as postRepo from './db/postRepository.js';
import * as userRepo from './db/userRepository.js';
import * as integrationRepo from './db/repositories/integrationRepository.js';
import { pollAndGenerateInsights } from './services/trendEngine.service.js';
import { runKeywordPoll } from './services/keywordPolling.service.js';
import * as keywordPollRepo from './db/keywordPollRepository.js';
import { canMakeLinkedInCall, incrementLinkedInUsage } from './services/rateLimit.js';
import { createPost as createLinkedInPost, createPostWithImage as createLinkedInImagePost, buildAuthorUrn } from './services/linkedin.js';
import { createPost as createFacebookPost, createPhotoPost as createFacebookPhotoPost } from './services/facebook.js';
import { createPost as createTwitterPost, uploadMedia as uploadTwitterMedia, refreshAccessToken as refreshTwitterToken } from './services/twitter.js';
import { createPost as createThreadsPost } from './services/threads.js';
import { createPost as createInstagramPost, createInstagramMediaContainer, publishInstagramMedia, waitForMediaReady } from './services/instagram.js';
import { resolveImageUrl } from './utils/imageUrl.js';
import { storeLinkedInPostInFirebase } from './services/linkedinStorage.service.js';

export async function processScheduledPosts() {
  try {
    const now = new Date();
    const due = await postRepo.find(
      { status: 'scheduled', scheduledAt: { $lte: now } },
      { limit: 10 }
    );

    for (const post of due) {
    console.log(`Processing scheduled post: ${post._id}`);
    const results = [];
    const errors = [];
    const platformIds = {};
    const platformUrls = {};

    // Get integrations for this user
    const integrations = await integrationRepo.find({
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
              if (resolvedUrl.startsWith('/') || resolvedUrl.includes('localhost') || resolvedUrl.includes('127.0.0.1')) {
                errors.push({ platform: 'linkedin', error: 'Image URL must be public. Set API_PUBLIC_URL in .env' });
                continue;
              }
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
            if (post.imageUrl) {
              const resolvedFbUrl = resolveImageUrl(post.imageUrl);
              if (resolvedFbUrl.startsWith('/') || resolvedFbUrl.includes('localhost') || resolvedFbUrl.includes('127.0.0.1')) {
                errors.push({ platform: 'facebook', error: 'Image URL must be public. Set API_PUBLIC_URL in .env' });
                continue;
              }
              result = await createFacebookPhotoPost(
                integration.facebookPageAccessToken,
                integration.facebookPageId,
                trimmed,
                resolvedFbUrl
              );
            } else {
              result = await createFacebookPost(
                integration.facebookPageAccessToken,
                integration.facebookPageId,
                trimmed
              );
            }
            break;

          case 'twitter':
            if (!integration.accessToken) {
              errors.push({ platform: 'twitter', error: 'Twitter credentials missing' });
              continue;
            }
            let twitterToken = integration.accessToken;
            const twExpired = integration.tokenExpiresAt && new Date(integration.tokenExpiresAt) < new Date(Date.now() + 5 * 60 * 1000);
            if (twExpired && integration.refreshToken) {
              const refreshed = await refreshTwitterToken(integration.refreshToken);
              if (!refreshed.error) {
                twitterToken = refreshed.access_token;
                await integrationRepo.findOneAndUpdate(
                  { userId: post.userId, platform: 'twitter' },
                  {
                    accessToken: refreshed.access_token,
                    refreshToken: refreshed.refresh_token || integration.refreshToken,
                    tokenExpiresAt: new Date(Date.now() + (refreshed.expires_in || 7200) * 1000),
                  },
                  { upsert: false, new: true }
                );
              }
            }
            let twitterMediaIds = [];
            if (post.imageUrl) {
              const resolvedTwUrl = resolveImageUrl(post.imageUrl);
              if (!resolvedTwUrl.startsWith('/') && !resolvedTwUrl.includes('localhost') && !resolvedTwUrl.includes('127.0.0.1')) {
                const uploadRes = await uploadTwitterMedia(twitterToken, resolvedTwUrl, {});
                if (!uploadRes.error) twitterMediaIds = [uploadRes.mediaId];
              }
            }
            result = await createTwitterPost(twitterToken, trimmed, twitterMediaIds);
            break;

          case 'threads':
            if (post.imageUrl) {
              const resolvedThreadsUrl = resolveImageUrl(post.imageUrl);
              if (resolvedThreadsUrl.startsWith('/') || resolvedThreadsUrl.includes('localhost') || resolvedThreadsUrl.includes('127.0.0.1')) {
                errors.push({ platform: 'threads', error: 'Image URL must be public. Set API_PUBLIC_URL in .env' });
                continue;
              }
              result = await createThreadsPost(
                integration.accessToken,
                integration.platformUserId,
                trimmed,
                { image_url: resolvedThreadsUrl }
              );
            } else {
              result = await createThreadsPost(
                integration.accessToken,
                integration.platformUserId,
                trimmed
              );
            }
            if (result.error && (result.error.includes('expired') || result.error.includes('Session has expired'))) {
              result.error = 'Threads session expired. Please reconnect in Integrations.';
            }
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

          await integrationRepo.updateLastUsed(integration._id, new Date());
        }
      } catch (err) {
        errors.push({ platform, error: err.message });
      }
    }

    if (results.length > 0) {
      await postRepo.findByIdAndUpdate(post._id, {
        status: 'published',
        publishedAt: new Date(),
        platformIds,
        platformUrls,
        ...(errors.length > 0 && { platformErrors: errors }),
      });
      if (platformIds.linkedin) {
        const updatedPost = await postRepo.findOne({ _id: post._id });
      if (updatedPost) storeLinkedInPostInFirebase(post.userId.toString(), updatedPost).catch(() => {});
      }
    } else {
      await postRepo.findByIdAndUpdate(post._id, {
        status: 'failed',
        platformErrors: errors,
      });
    }
  }
  } catch (err) {
    if (err.message?.includes('Could not load the default credentials') || err.message?.includes('credentials')) {
      // Firestore not available (no service account) - skip silently
      return;
    }
    console.error('Scheduler (scheduled posts):', err.message);
  }
}

export async function processTrendPolling() {
  try {
    const users = await userRepo.find({});
    for (const u of users) {
      try {
        await pollAndGenerateInsights(u._id);
      } catch (e) {
        console.error(`Trend poll failed for user ${u._id}:`, e.message);
      }
    }
  } catch (err) {
    if (err.message?.includes('Could not load the default credentials') || err.message?.includes('credentials')) {
      return; // Firestore not available (no service account) - skip silently
    }
    console.error('Trend polling error:', err);
  }
}

export async function processKeywordPolling() {
  try {
    const polls = await keywordPollRepo.find({ enabled: true });
    for (const p of polls) {
      try {
        await runKeywordPoll(p.userId);
      } catch (e) {
        console.error(`Keyword poll failed for user ${p.userId}:`, e.message);
      }
    }
  } catch (err) {
    if (err.message?.includes('Could not load the default credentials') || err.message?.includes('credentials')) {
      return; // Firestore not available (no service account) - skip silently
    }
    console.error('Keyword polling error:', err);
  }
}

export function startScheduler() {
  cron.schedule('* * * * *', processScheduledPosts);
  console.log('Scheduler: running every minute');

  // Trend engine: poll every 30 minutes
  cron.schedule('*/30 * * * *', processTrendPolling);
  console.log('Trend engine: polling every 30 minutes');

  // Keyword polling: every 60 minutes
  cron.schedule('0 * * * *', processKeywordPolling);
  console.log('Keyword polling: every hour');
}
