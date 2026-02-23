import { Router } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { Integration } from '../models/Integration.js';
import { requireAuth } from '../middleware/auth.js';
import { getMemberId } from '../services/linkedin.js';
import { verifyFacebookToken, getPages, exchangeToken } from '../services/facebook.js';
import { generatePKCEChallenge, exchangeOAuth2Code, verifyTwitterCredentials } from '../services/twitter.js';
import { exchangeCodeForToken, getThreadsUser } from '../services/threads.js';
import { exchangeCodeForToken as exchangeInstagramCode, exchangeForLongLivedToken, getFacebookUser, getPagesWithInstagram, getInstagramAccount, exchangeInstagramLoginCode } from '../services/instagram.js';

const router = Router();
const { linkedin, frontendUrl } = config;

// Instagram callback - NO auth (receives redirect from Instagram with no session)
router.get('/instagram/callback', async (req, res) => {
  const { code, state, error, error_reason } = req.query;

  console.log('Instagram callback received:', { hasCode: !!code, stateLen: state?.length, error });

  if (error) {
    return res.redirect(`${frontendUrl}/home?error=${encodeURIComponent(error_reason || error)}`);
  }

  let savedUserId = null;
  if (state) {
    try {
      const decoded = jwt.verify(state, config.jwt.secret);
      savedUserId = decoded?.userId;
    } catch (_) {}
  }
  if (!savedUserId) {
    console.error('Instagram callback: invalid/expired state');
    return res.redirect(`${frontendUrl}/home?error=${encodeURIComponent('Connection timed out. Please try connecting again from the dashboard.')}`);
  }

  if (!code) {
    return res.redirect(`${frontendUrl}/home?error=missing_code`);
  }

  try {
    console.log('Exchanging Instagram token with redirectUri:', config.instagram.redirectUri);
    const tokenResult = await exchangeInstagramLoginCode(code, config.instagram.redirectUri);

    if (tokenResult.error) {
      return res.redirect(`${frontendUrl}/home?error=${encodeURIComponent(tokenResult.error)}`);
    }

    const accessToken = tokenResult.access_token;
    const instagramUserId = tokenResult.user_id;

    console.log('Token exchange successful:', instagramUserId);

    const integrationData = {
      userId: savedUserId,
      platform: 'instagram',
      platformUserId: instagramUserId,
      platformUsername: `instagram_user_${instagramUserId}`,
      accessToken,
      tokenExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      profile: { name: instagramUserId, username: `instagram_user_${instagramUserId}` },
      isActive: true,
      lastUsedAt: new Date(),
    };

    await Integration.findOneAndUpdate(
      { userId: savedUserId, platform: 'instagram' },
      integrationData,
      { upsert: true, new: true }
    );

    console.log('Instagram integration successful');
    res.redirect(`${frontendUrl}/home?integration=instagram&status=connected`);
  } catch (err) {
    console.error('Instagram callback error:', err);
    const msg = err.response?.data?.error?.message || err.message;
    res.redirect(`${frontendUrl}/home?error=${encodeURIComponent(msg)}`);
  }
});

// All other integration routes require authentication
router.use(requireAuth);

// LinkedIn Integration
router.get('/linkedin', (req, res) => {
  const state = uuidv4();
  req.session = req.session || {};
  req.session.linkedinOAuthState = state;
  req.session.linkedinUserId = req.user._id; // Use MongoDB _id
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: linkedin.clientId,
    redirect_uri: `${frontendUrl}/api/auth/integrations/linkedin/callback`,
    state,
    scope: linkedin.scope,
  });
  res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`);
});

router.get('/linkedin/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) {
    return res.redirect(`${frontendUrl}/home?error=${encodeURIComponent(error_description || error)}`);
  }
  const savedState = req.session?.linkedinOAuthState;
  const savedUserId = req.session?.linkedinUserId;
  if (!savedState || savedState !== state || !savedUserId) {
    return res.redirect(`${frontendUrl}/home?error=${encodeURIComponent('Connection timed out. Please try connecting again from the dashboard.')}`);
  }
  if (!code) {
    return res.redirect(`${frontendUrl}/integrations?error=missing_code`);
  }
  if (!linkedin.clientSecret) {
    return res.redirect(`${frontendUrl}/home?error=server_config`);
  }
  try {
    const { data } = await axios.post(
      'https://www.linkedin.com/oauth/v2/accessToken',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: linkedin.clientId,
        client_secret: linkedin.clientSecret,
        redirect_uri: `${frontendUrl}/api/auth/integrations/linkedin/callback`,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const accessToken = data.access_token;
    const expiresIn = data.expires_in || 5184000;
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
    const member = await getMemberId(accessToken);
    const linkedinId = member?.id ?? null;
    const profile = member?.profile;

    const integrationData = {
      userId: savedUserId,
      platform: 'linkedin',
      platformUserId: linkedinId,
      accessToken,
      refreshToken: data.refresh_token || undefined,
      tokenExpiresAt,
      profile: profile
        ? {
          name: `${profile.given_name || ''} ${profile.family_name || ''}`.trim() || profile.localizedFirstName || 'LinkedIn User',
          username: linkedinId,
          profilePicture: profile.picture || profile.profilePicture?.displayImage,
        }
        : undefined,
      isActive: true,
      lastUsedAt: new Date(),
    };

    // Find and update or create integration in MongoDB
    await Integration.findOneAndUpdate(
      { userId: savedUserId, platform: 'linkedin' },
      integrationData,
      { upsert: true, new: true }
    );

    delete req.session.linkedinOAuthState;
    delete req.session.linkedinUserId;
    req.session.save(() => {
      res.redirect(`${frontendUrl}/home?integration=linkedin&status=connected`);
    });
  } catch (err) {
    const msg = err.response?.data?.error_description || err.message;
    res.redirect(`${frontendUrl}/home?error=${encodeURIComponent(msg)}`);
  }
});

// Facebook Integration
router.get('/facebook', (req, res) => {
  const state = uuidv4();
  req.session = req.session || {};
  req.session.facebookOAuthState = state;
  req.session.facebookUserId = req.user._id;

  const params = new URLSearchParams({
    client_id: config.facebook.appId,
    redirect_uri: `${frontendUrl}/api/auth/integrations/facebook/callback`,
    state,
    scope: 'public_profile,email,pages_show_list,pages_read_engagement,pages_manage_engagement,pages_manage_posts,pages_read_user_content',
    response_type: 'code',
  });

  res.redirect(`https://www.facebook.com/v18.0/dialog/oauth?${params}`);
});

router.get('/facebook/callback', async (req, res) => {
  const { code, state, error, error_reason } = req.query;

  if (error) {
    return res.redirect(`${frontendUrl}/home?error=${encodeURIComponent(error_reason || error)}`);
  }

  const savedState = req.session?.facebookOAuthState;
  const savedUserId = req.session?.facebookUserId;
  if (!savedState || savedState !== state || !savedUserId) {
    return res.redirect(`${frontendUrl}/home?error=${encodeURIComponent('Connection timed out. Please try connecting again from the dashboard.')}`);
  }

  if (!code) {
    return res.redirect(`${frontendUrl}/integrations?error=missing_code`);
  }

  try {
    const { data: tokenData } = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        client_id: config.facebook.appId,
        client_secret: config.facebook.appSecret,
        redirect_uri: `${frontendUrl}/api/auth/integrations/facebook/callback`,
        code,
      },
    });

    const shortLivedToken = tokenData.access_token;
    const longLivedResult = await exchangeToken(shortLivedToken);
    const accessToken = longLivedResult.access_token || shortLivedToken;
    const expiresIn = longLivedResult.expires_in || tokenData.expires_in || 5184000;

    const profile = await verifyFacebookToken(accessToken);
    if (!profile) {
      return res.redirect(`${frontendUrl}/home?error=invalid_token`);
    }

    const { id: facebookId, name, picture } = profile;
    const pages = await getPages(accessToken);

    req.session.facebookAccessToken = accessToken;
    req.session.facebookId = facebookId;
    req.session.facebookProfile = { name, picture };
    req.session.facebookPages = pages;
    req.session.facebookTokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
    req.session.facebookUserId = savedUserId;
    delete req.session.facebookOAuthState;

    req.session.save(() => {
      res.redirect(`${frontendUrl}/integrations/facebook/select-page`);
    });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.redirect(`${frontendUrl}/home?error=${encodeURIComponent(msg)}`);
  }
});

router.get('/facebook/pages', requireAuth, (req, res) => {
  if (!req.session.facebookPages) {
    return res.status(401).json({ error: 'No Facebook session found. Please sign in again.' });
  }
  res.json({ pages: req.session.facebookPages });
});

router.post('/facebook/select-page', requireAuth, async (req, res) => {
  const { pageId } = req.body;
  const savedUserId = req.session?.facebookUserId;

  if (!req.session.facebookAccessToken || !req.session.facebookId || !savedUserId) {
    return res.status(401).json({ error: 'No Facebook session found. Please sign in again.' });
  }

  if (!pageId) {
    return res.status(400).json({ error: 'Page ID is required' });
  }

  const pages = req.session.facebookPages || [];
  const selectedPage = pages.find(p => p.id === pageId);

  if (!selectedPage) {
    return res.status(400).json({ error: 'Page not found' });
  }

  try {
    const { id: facebookId, name, picture } = req.session.facebookProfile;
    const accessToken = req.session.facebookAccessToken;
    const tokenExpiresAt = req.session.facebookTokenExpiresAt;

    const integrationData = {
      userId: savedUserId,
      platform: 'facebook',
      platformUserId: facebookId,
      accessToken,
      tokenExpiresAt,
      facebookPageId: selectedPage.id,
      facebookPageAccessToken: selectedPage.access_token,
      facebookPageName: selectedPage.name,
      profile: {
        name: name || 'Facebook User',
        username: facebookId,
        profilePicture: picture,
      },
      isActive: true,
      lastUsedAt: new Date(),
    };

    // Find and update or create integration in MongoDB
    await Integration.findOneAndUpdate(
      { userId: savedUserId, platform: 'facebook' },
      integrationData,
      { upsert: true, new: true }
    );

    delete req.session.facebookAccessToken;
    delete req.session.facebookId;
    delete req.session.facebookProfile;
    delete req.session.facebookPages;
    delete req.session.facebookTokenExpiresAt;
    delete req.session.facebookUserId;

    req.session.save(() => {
      res.json({ ok: true });
    });
  } catch (err) {
    console.error('Facebook Page Selection Error:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Twitter Integration
router.get('/twitter', async (req, res) => {
  try {
    const state = uuidv4();
    const { verifier, challenge } = generatePKCEChallenge();

    req.session = req.session || {};
    req.session.twitterOAuthState = state;
    req.session.twitterCodeVerifier = verifier;
    req.session.twitterUserId = req.user._id;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.twitter.clientId,
      redirect_uri: `${frontendUrl}/api/auth/integrations/twitter/callback`,
      scope: 'tweet.read tweet.write users.read offline.access',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    res.redirect(`https://twitter.com/i/oauth2/authorize?${params}`);
  } catch (err) {
    res.redirect(`${frontendUrl}/home?error=${encodeURIComponent(err.message)}`);
  }
});

router.get('/twitter/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${frontendUrl}/home?error=${encodeURIComponent(error)}`);
  }

  const savedState = req.session?.twitterOAuthState;
  const codeVerifier = req.session?.twitterCodeVerifier;
  const savedUserId = req.session?.twitterUserId;

  if (!savedState || savedState !== state || !savedUserId) {
    return res.redirect(`${frontendUrl}/home?error=${encodeURIComponent('Connection timed out. Please try connecting again from the dashboard.')}`);
  }

  if (!code || !codeVerifier) {
    return res.redirect(`${frontendUrl}/home?error=missing_params`);
  }

  try {
    const redirectUri = `${frontendUrl}/api/auth/integrations/twitter/callback`;
    const tokenData = await exchangeOAuth2Code(code, codeVerifier, redirectUri);

    if (tokenData.error) {
      return res.redirect(`${frontendUrl}/home?error=${encodeURIComponent(tokenData.error)}`);
    }

    const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = tokenData;

    const userInfo = await verifyTwitterCredentials(accessToken);

    if (!userInfo) {
      return res.redirect(`${frontendUrl}/home?error=twitter_verification_failed`);
    }

    const { id: twitterId, username, name, profilePicture } = userInfo;

    const integrationData = {
      userId: savedUserId,
      platform: 'twitter',
      platformUserId: twitterId,
      platformUsername: username,
      accessToken,
      refreshToken,
      tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
      profile: {
        name: name || username,
        username: username,
        profilePicture: profilePicture || `https://unavatar.io/twitter/${username}`,
      },
      isActive: true,
      lastUsedAt: new Date(),
    };

    // Find and update or create integration in MongoDB
    await Integration.findOneAndUpdate(
      { userId: savedUserId, platform: 'twitter' },
      integrationData,
      { upsert: true, new: true }
    );

    delete req.session.twitterOAuthState;
    delete req.session.twitterCodeVerifier;
    delete req.session.twitterUserId;

    req.session.save(() => {
      res.redirect(`${frontendUrl}/home?integration=twitter&status=connected`);
    });
  } catch (err) {
    res.redirect(`${frontendUrl}/home?error=${encodeURIComponent(err.message)}`);
  }
});

// Threads Integration
router.get('/threads', (req, res) => {
  const state = uuidv4();
  req.session = req.session || {};
  req.session.threadsOAuthState = state;
  req.session.threadsUserId = req.user._id;

  const params = new URLSearchParams({
    client_id: config.threads.appId,
    redirect_uri: `${frontendUrl}/api/auth/integrations/threads/callback`,
    scope: 'threads_basic,threads_content_publish,threads_manage_replies',
    response_type: 'code',
    state,
  });

  res.redirect(`https://threads.net/oauth/authorize?${params}`);
});

router.get('/threads/callback', async (req, res) => {
  const { code, state, error, error_reason, error_description } = req.query;

  if (error) {
    return res.redirect(`${frontendUrl}/home?error=${encodeURIComponent(error_description || error_reason || error)}`);
  }

  const savedState = req.session?.threadsOAuthState;
  const savedUserId = req.session?.threadsUserId;
  if (!savedState || savedState !== state || !savedUserId) {
    return res.redirect(`${frontendUrl}/home?error=${encodeURIComponent('Connection timed out. Please try connecting again from the dashboard.')}`);
  }

  if (!code) {
    return res.redirect(`${frontendUrl}/home?error=missing_code`);
  }

  try {
    // Strip #_ from code if present
    const cleanCode = code.replace(/#_$/, '');

    const result = await exchangeCodeForToken(cleanCode);

    if (result.error) {
      return res.redirect(`${frontendUrl}/home?error=${encodeURIComponent(result.error)}`);
    }

    const { access_token: accessToken, user_id: threadsUserId } = result;

    const userInfo = await getThreadsUser(accessToken, threadsUserId);

    if (userInfo.error) {
      return res.redirect(`${frontendUrl}/home?error=${encodeURIComponent(userInfo.error)}`);
    }

    const integrationData = {
      userId: savedUserId,
      platform: 'threads',
      platformUserId: threadsUserId,
      platformUsername: userInfo.username,
      accessToken,
      profile: {
        name: userInfo.username || 'Threads User',
        username: userInfo.username,
      },
      isActive: true,
      lastUsedAt: new Date(),
    };

    // Find and update or create integration in MongoDB
    await Integration.findOneAndUpdate(
      { userId: savedUserId, platform: 'threads' },
      integrationData,
      { upsert: true, new: true }
    );

    delete req.session.threadsOAuthState;
    delete req.session.threadsUserId;

    req.session.save(() => {
      res.redirect(`${frontendUrl}/home?integration=threads&status=connected`);
    });
  } catch (err) {
    const msg = err.response?.data?.error_message || err.message;
    res.redirect(`${frontendUrl}/home?error=${encodeURIComponent(msg)}`);
  }
});

// Instagram Direct Login - userId encoded in state JWT (no cookie/session needed across redirect)
router.get('/instagram', (req, res) => {
  const statePayload = { userId: req.user._id.toString(), n: uuidv4() };
  const state = jwt.sign(statePayload, config.jwt.secret, { expiresIn: '10m' });

  const params = new URLSearchParams({
    client_id: config.instagram.appId,
    redirect_uri: config.instagram.redirectUri,
    response_type: 'code',
    scope: 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish,instagram_business_manage_insights',
    state,
  });

  console.log('Instagram OAuth start ->', config.instagram.redirectUri);
  res.redirect(`https://api.instagram.com/oauth/authorize?${params}`);
});

export default router;
