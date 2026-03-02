import { Router } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import * as integrationRepo from '../db/repositories/integrationRepository.js';
import { getMemberId } from '../services/linkedin.js';
import { verifyFacebookToken, getPages, exchangeToken } from '../services/facebook.js';
import { generatePKCEChallenge, exchangeOAuth2Code, verifyTwitterCredentials, getOAuth1RequestToken, exchangeOAuth1AccessToken } from '../services/twitter.js';
import { exchangeCodeForToken, exchangeForLongLivedToken as exchangeThreadsLongLivedToken, getThreadsUser } from '../services/threads.js';
import { exchangeCodeForToken as exchangeInstagramCode, exchangeForLongLivedToken, getFacebookUser, getPagesWithInstagram, getInstagramAccount, exchangeInstagramLoginCode } from '../services/instagram.js';

const router = Router();
const { linkedin, frontendUrl } = config;

// Helper: render HTML that postMessages integration to opener (for popup OAuth - no Firestore on server)
function renderOAuthCallback(res, integration, errorMsg) {
  const data = errorMsg ? { error: errorMsg } : integration;
  const html = `<!DOCTYPE html><html><head><title>Connecting...</title></head><body>
<script>
(function(){
  var d = ${JSON.stringify(data)};
  if (window.opener) {
    window.opener.postMessage({ type: 'blazly-oauth-callback', ...d }, '*');
  }
  window.close();
})();
</script><p>${errorMsg ? 'Error: ' + errorMsg : 'Connected! Closing...'}</p></body></html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}

// Instagram callback - NO auth (receives redirect from Instagram with no session)
router.get('/instagram/callback', async (req, res) => {
  const { code, state, error, error_reason } = req.query;

  console.log('Instagram callback received:', { hasCode: !!code, stateLen: state?.length, error });

  if (error) {
    return renderOAuthCallback(res, null, error_reason || error);
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
    return renderOAuthCallback(res, null, 'Connection timed out. Please try again.');
  }

  if (!code) {
    return renderOAuthCallback(res, null, 'Missing authorization code');
  }

  try {
    console.log('Exchanging Instagram token with redirectUri:', config.instagram.redirectUri);
    const tokenResult = await exchangeInstagramLoginCode(code, config.instagram.redirectUri);

    if (tokenResult.error) {
      return renderOAuthCallback(res, null, tokenResult.error);
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
      tokenExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      profile: { name: instagramUserId, username: `instagram_user_${instagramUserId}` },
      isActive: true,
      lastUsedAt: new Date().toISOString(),
    };

    console.log('Instagram integration successful');
    renderOAuthCallback(res, integrationData);
  } catch (err) {
    console.error('Instagram callback error:', err);
    const msg = err.response?.data?.error?.message || err.message;
    renderOAuthCallback(res, null, msg);
  }
});

// LinkedIn callback - NO auth (receives redirect from LinkedIn with no session; userId in state JWT)
router.get('/linkedin/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) {
    return renderOAuthCallback(res, null, error_description || error);
  }
  let savedUserId = null;
  try {
    const decoded = jwt.verify(state, config.jwt.secret);
    savedUserId = decoded?.userId;
  } catch (_) {}
  if (!savedUserId) {
    return renderOAuthCallback(res, null, 'Connection timed out. Please try again.');
  }
  if (!code) {
    return renderOAuthCallback(res, null, 'Missing authorization code');
  }
  if (!linkedin.clientSecret) {
    return renderOAuthCallback(res, null, 'Server configuration error');
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
      tokenExpiresAt: tokenExpiresAt.toISOString(),
      profile: profile
        ? {
          name: `${profile.given_name || ''} ${profile.family_name || ''}`.trim() || profile.localizedFirstName || 'LinkedIn User',
          username: linkedinId,
          profilePicture: profile.picture || profile.profilePicture?.displayImage,
        }
        : undefined,
      isActive: true,
      lastUsedAt: new Date().toISOString(),
    };

    renderOAuthCallback(res, integrationData);
  } catch (err) {
    const msg = err.response?.data?.error_description || err.message;
    renderOAuthCallback(res, null, msg);
  }
});

// Helper: return redirect URL as JSON when client wants it (fetch with redirect:'manual' can't read Location)
function wantsJson(req) {
  return req.get('Accept')?.includes('application/json') || req.get('X-Popup-OAuth') === '1';
}

// Facebook callback - NO auth (receives redirect from Facebook with no session)
// Uses JWT in state to identify user instead of session cookies
router.get('/facebook/callback', async (req, res) => {
  const { code, state, error, error_reason } = req.query;

  if (error) {
    return renderOAuthCallback(res, null, error_reason || error);
  }

  let savedUserId = null;
  if (state) {
    try {
      const decoded = jwt.verify(state, config.jwt.secret);
      savedUserId = decoded?.userId;
    } catch (_) {}
  }
  if (!savedUserId) {
    return renderOAuthCallback(res, null, 'Connection timed out. Please try connecting again from the dashboard.');
  }

  if (!code) {
    return renderOAuthCallback(res, null, 'Missing authorization code');
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
      return renderOAuthCallback(res, null, 'Invalid Facebook token');
    }

    const { id: facebookId, name, picture } = profile;
    const pages = await getPages(accessToken);

    // Auto-use the first page - no separate page selection step needed
    const firstPage = pages?.[0] || null;
    const pageAccessToken = firstPage?.access_token || accessToken;
    const pageId = firstPage?.id || null;
    const pageName = firstPage?.name || name;
    const igAccount = firstPage?.instagram_business_account;

    const integrationData = {
      userId: savedUserId,
      platform: 'facebook',
      platformUserId: facebookId,
      platformUsername: pageName || name || facebookId,
      accessToken,
      tokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      facebookPageId: pageId,
      facebookPageAccessToken: pageAccessToken,
      facebookPageName: pageName,
      instagramBusinessAccountId: igAccount?.id || null,
      instagramPageAccessToken: igAccount?.id ? pageAccessToken : null,
      profile: { name: pageName || name || 'Facebook User', picture: picture?.data?.url || picture },
      isActive: true,
      lastUsedAt: new Date().toISOString(),
    };

    renderOAuthCallback(res, integrationData);
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    renderOAuthCallback(res, null, msg);
  }
});

// Threads callback - NO auth (receives redirect from Threads with no session)
// Uses JWT in state to identify user
router.get('/threads/callback', async (req, res) => {
  const { code, state, error, error_reason, error_description } = req.query;

  if (error) {
    return renderOAuthCallback(res, null, error_description || error_reason || error);
  }

  let savedUserId = null;
  if (state) {
    try {
      const decoded = jwt.verify(state, config.jwt.secret);
      savedUserId = decoded?.userId;
    } catch (_) {}
  }
  if (!savedUserId) {
    return renderOAuthCallback(res, null, 'Connection timed out. Please try connecting again from the dashboard.');
  }

  if (!code) {
    return renderOAuthCallback(res, null, 'Missing authorization code');
  }

  try {
    const cleanCode = code.replace(/#_$/, '');
    const result = await exchangeCodeForToken(cleanCode);

    if (result.error) {
      return renderOAuthCallback(res, null, result.error);
    }

    const { access_token: shortToken, user_id: threadsUserId } = result;

    // Exchange short-lived token (1h) for long-lived token (60 days)
    const longLived = await exchangeThreadsLongLivedToken(shortToken);
    const accessToken = longLived.access_token;
    const tokenExpiresAt = new Date(Date.now() + (longLived.expires_in || 5184000) * 1000).toISOString();

    const userInfo = await getThreadsUser(accessToken, threadsUserId);

    if (userInfo.error) {
      return renderOAuthCallback(res, null, userInfo.error);
    }

    const integrationData = {
      userId: savedUserId,
      platform: 'threads',
      platformUserId: String(threadsUserId), // Store as string — Threads IDs exceed MAX_SAFE_INTEGER
      platformUsername: userInfo.username,
      accessToken,
      tokenExpiresAt,
      profile: {
        name: userInfo.username || 'Threads User',
        username: userInfo.username,
      },
      isActive: true,
      lastUsedAt: new Date().toISOString(),
    };

    renderOAuthCallback(res, integrationData);
  } catch (err) {
    const msg = err.response?.data?.error_message || err.message;
    renderOAuthCallback(res, null, msg);
  }
});

// Twitter callback - NO auth (receives redirect from Twitter with no session)
// Uses JWT in state to identify user and retrieve PKCE code verifier
router.get('/twitter/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return renderOAuthCallback(res, null, error);
  }

  let savedUserId = null;
  let codeVerifier = null;
  if (state) {
    try {
      const decoded = jwt.verify(state, config.jwt.secret);
      savedUserId = decoded?.userId;
      codeVerifier = decoded?.codeVerifier;
    } catch (_) {}
  }

  if (!savedUserId || !codeVerifier) {
    return renderOAuthCallback(res, null, 'Connection timed out. Please try connecting again.');
  }

  if (!code) {
    return renderOAuthCallback(res, null, 'Missing authorization code');
  }

  try {
    const redirectUri = `${frontendUrl}/api/auth/integrations/twitter/callback`;
    const tokenData = await exchangeOAuth2Code(code, codeVerifier, redirectUri);

    if (tokenData.error) {
      return renderOAuthCallback(res, null, tokenData.error);
    }

    const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = tokenData;
    const userInfo = await verifyTwitterCredentials(accessToken);

    if (!userInfo) {
      return renderOAuthCallback(res, null, 'Twitter verification failed');
    }

    const { id: twitterId, username, name, profilePicture } = userInfo;

    const integrationData = {
      userId: savedUserId,
      platform: 'twitter',
      platformUserId: twitterId,
      platformUsername: username,
      accessToken,
      refreshToken,
      tokenExpiresAt: new Date(Date.now() + (expiresIn || 7200) * 1000).toISOString(),
      profile: {
        name: name || username,
        username,
        profilePicture: profilePicture || `https://unavatar.io/twitter/${username}`,
      },
      isActive: true,
      lastUsedAt: new Date().toISOString(),
    };

    renderOAuthCallback(res, integrationData);
  } catch (err) {
    renderOAuthCallback(res, null, err.response?.data?.error_description || err.message);
  }
});

// All other integration routes require authentication
router.use(requireAuth);

// LinkedIn Integration - state = JWT with userId (no session needed)
// Always uses the primary LinkedIn posting app (86swiutwriegdi) for OAuth.
// Community Management app credentials are used separately for analytics/comments API calls.
router.get('/linkedin', (req, res) => {
  const state = jwt.sign(
    { userId: req.user._id, n: uuidv4() },
    config.jwt.secret,
    { expiresIn: '10m' }
  );
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: linkedin.clientId,
    redirect_uri: `${frontendUrl}/api/auth/integrations/linkedin/callback`,
    state,
    scope: linkedin.scope,
  });
  const url = `https://www.linkedin.com/oauth/v2/authorization?${params}`;
  if (wantsJson(req)) return res.json({ redirectUrl: url });
  res.redirect(url);
});

// Facebook Integration - uses JWT in state (no session dependency)
router.get('/facebook', (req, res) => {
  const state = jwt.sign({ userId: req.user._id, n: uuidv4() }, config.jwt.secret, { expiresIn: '10m' });

  const params = new URLSearchParams({
    client_id: config.facebook.appId,
    redirect_uri: `${frontendUrl}/api/auth/integrations/facebook/callback`,
    state,
    scope: 'public_profile,email,pages_show_list,pages_read_engagement,pages_manage_engagement,pages_manage_posts,pages_read_user_content,instagram_basic',
    response_type: 'code',
  });

  const url = `https://www.facebook.com/v18.0/dialog/oauth?${params}`;
  if (wantsJson(req)) return res.json({ redirectUrl: url });
  res.redirect(url);
});


// Twitter Integration - state = JWT with userId + PKCE verifier (no session needed)
router.get('/twitter', async (req, res) => {
  try {
    const { verifier, challenge } = generatePKCEChallenge();
    // Embed userId and codeVerifier in JWT state so callback is session-free
    const state = jwt.sign(
      { userId: req.user._id, codeVerifier: verifier, n: uuidv4() },
      config.jwt.secret,
      { expiresIn: '10m' }
    );

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.twitter.clientId,
      redirect_uri: `${frontendUrl}/api/auth/integrations/twitter/callback`,
      scope: 'tweet.read tweet.write users.read offline.access',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    const url = `https://twitter.com/i/oauth2/authorize?${params}`;
    if (wantsJson(req)) return res.json({ redirectUrl: url });
    res.redirect(url);
  } catch (err) {
    if (wantsJson(req)) return res.status(500).json({ error: err.message });
    res.redirect(`${frontendUrl}/home?error=${encodeURIComponent(err.message)}`);
  }
});

// Twitter OAuth 1.0a - for media upload (image posting)
router.get('/twitter/oauth1', async (req, res) => {
  try {
    const redirectUri = `${frontendUrl}/api/auth/integrations/twitter/oauth1/callback`;
    const result = await getOAuth1RequestToken(redirectUri);
    if (result.error) {
      if (wantsJson(req)) return res.status(400).json({ error: result.error });
      return res.redirect(`${frontendUrl}/integrations?error=${encodeURIComponent(result.error)}`);
    }
    req.session = req.session || {};
    req.session.twitterOAuth1RequestSecret = result.oauth_token_secret;
    req.session.twitterOAuth1UserId = req.user._id?.toString?.() || req.user._id;
    const url = `https://api.twitter.com/oauth/authorize?oauth_token=${result.oauth_token}`;
    if (wantsJson(req)) return res.json({ redirectUrl: url });
    res.redirect(url);
  } catch (err) {
    if (wantsJson(req)) return res.status(500).json({ error: err.message });
    res.redirect(`${frontendUrl}/integrations?error=${encodeURIComponent(err.message)}`);
  }
});

router.get('/twitter/oauth1/callback', async (req, res) => {
  const { oauth_token, oauth_verifier } = req.query;
  const secret = req.session?.twitterOAuth1RequestSecret;
  const userId = req.session?.twitterOAuth1UserId;

  if (!oauth_token || !oauth_verifier || !secret || !userId) {
    return res.redirect(`${frontendUrl}/integrations?error=oauth1_callback_missing_params`);
  }

  try {
    const result = await exchangeOAuth1AccessToken(oauth_token, oauth_verifier, secret);
    if (result.error) {
      return res.redirect(`${frontendUrl}/integrations?error=${encodeURIComponent(result.error)}`);
    }

    await integrationRepo.findOneAndUpdate(
      { userId, platform: 'twitter' },
      {
        twitterOAuth1AccessToken: result.oauth_token,
        accessTokenSecret: result.oauth_token_secret,
      },
      { upsert: false, new: true }
    );

    delete req.session.twitterOAuth1RequestSecret;
    delete req.session.twitterOAuth1UserId;
    req.session.save(() => {
      res.redirect(`${frontendUrl}/integrations?twitter_oauth1=success`);
    });
  } catch (err) {
    res.redirect(`${frontendUrl}/integrations?error=${encodeURIComponent(err.message)}`);
  }
});


// Threads Integration - uses JWT in state (popup-safe, no session dependency)
router.get('/threads', (req, res) => {
  const state = jwt.sign({ userId: req.user._id, n: uuidv4() }, config.jwt.secret, { expiresIn: '10m' });

  const params = new URLSearchParams({
    client_id: config.threads.appId,
    redirect_uri: `${frontendUrl}/api/auth/integrations/threads/callback`,
    scope: 'threads_basic,threads_content_publish,threads_manage_replies,threads_keyword_search,threads_manage_insights',
    response_type: 'code',
    state,
  });

  const url = `https://threads.net/oauth/authorize?${params}`;
  if (wantsJson(req)) return res.json({ redirectUrl: url });
  res.redirect(url);
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

  const url = `https://api.instagram.com/oauth/authorize?${params}`;
  if (wantsJson(req)) return res.json({ redirectUrl: url });
  res.redirect(url);
});

export default router;
