import { Router } from 'express';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import * as userRepo from '../db/userRepository.js';
import * as integrationRepo from '../db/repositories/integrationRepository.js';
import { createSession, destroySession, saveSessionAndRespond } from '../services/authSession.js';
import { getMemberId } from '../services/linkedin.js';
import { verifyFacebookToken, getPages, exchangeToken } from '../services/facebook.js';
import { generatePKCEChallenge, exchangeOAuth2Code, verifyTwitterCredentials } from '../services/twitter.js';

const router = Router();
const { linkedin, frontendUrl } = config;

// Email/Password Signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const fullName = (name || '').trim();

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const existingUser = await userRepo.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const user = await userRepo.create({
      email,
      password,
      name: fullName,
      profile: {
        profilePicture: `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName || 'User')}&background=random`,
      },
      settings: {
        theme: 'light',
        notifications: true
      }
    });

    const token = createSession(req, user);
    saveSessionAndRespond(req, res, {
      ok: true,
      isNew: true,
      token,
      user: { id: user._id, email: user.email, profile: user.profile },
    });
  } catch (err) {
    console.error('Signup Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Email/Password Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await userRepo.findOne({ email });
    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await userRepo.comparePassword(user, password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = createSession(req, user);
    saveSessionAndRespond(req, res, {
      ok: true,
      token,
      user: { id: user._id, email: user.email, profile: user.profile },
    });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/linkedin', (req, res) => {
  const state = uuidv4();
  req.session = req.session || {};
  req.session.oauthState = state;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: linkedin.clientId,
    redirect_uri: linkedin.redirectUri,
    state,
    scope: linkedin.scope,
  });
  res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`);
});

router.get('/linkedin/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) {
    return res.redirect(`${frontendUrl}/?error=${encodeURIComponent(error_description || error)}`);
  }
  const savedState = req.session?.oauthState;
  if (!savedState || savedState !== state) {
    return res.status(401).send('Invalid state');
  }
  if (!code) {
    return res.redirect(`${frontendUrl}/?error=missing_code`);
  }
  if (!linkedin.clientSecret) {
    return res.redirect(`${frontendUrl}/?error=server_config`);
  }
  try {
    const { data } = await axios.post(
      'https://www.linkedin.com/oauth/v2/accessToken',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: linkedin.clientId,
        client_secret: linkedin.clientSecret,
        redirect_uri: linkedin.redirectUri,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const accessToken = data.access_token;
    const expiresIn = data.expires_in || 5184000;
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
    const member = await getMemberId(accessToken);
    const linkedinId = member?.id ?? null;
    const profile = member?.profile;

    // Find or create user
    let user = await userRepo.findOne({ email: profile?.email });
    if (!user) {
      user = await userRepo.create({
        profile: profile
          ? {
            firstName: profile.given_name || profile.localizedFirstName || profile.firstName?.localized?.en_US,
            lastName: profile.family_name || profile.localizedLastName || profile.lastName?.localized?.en_US,
            profilePicture: profile.picture || profile.profilePicture?.displayImage,
          }
          : undefined,
      });
    } else if (profile) {
      user = await userRepo.findByIdAndUpdate(user._id, {
        profile: {
          firstName: profile.given_name || profile.localizedFirstName || profile.firstName?.localized?.en_US || user.profile?.firstName,
          lastName: profile.family_name || profile.localizedLastName || profile.lastName?.localized?.en_US || user.profile?.lastName,
          profilePicture: profile.picture || profile.profilePicture?.displayImage || user.profile?.profilePicture,
        },
      }, { new: true });
    }

    // Create or update LinkedIn integration
    await integrationRepo.findOneAndUpdate(
      { userId: user._id, platform: 'linkedin' },
      {
        userId: user._id,
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
      },
      { upsert: true, new: true }
    );

    createSession(req, user);
    req.session.save((err) => {
      if (err) return res.redirect(`${frontendUrl}/?error=${encodeURIComponent(err.message)}`);
      res.redirect(`${frontendUrl}/home`);
    });
  } catch (err) {
    const msg = err.response?.data?.error_description || err.message;
    res.redirect(`${frontendUrl}/?error=${encodeURIComponent(msg)}`);
  }
});

router.post('/logout', (req, res) => {
  destroySession(req, res, (err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.json({ ok: true });
  });
});

// Facebook OAuth flow - Step 1: Redirect to Facebook
router.get('/facebook', (req, res) => {
  const state = uuidv4();
  req.session = req.session || {};
  req.session.facebookOAuthState = state;

  const params = new URLSearchParams({
    client_id: config.facebook.appId,
    redirect_uri: `${config.frontendUrl}/api/auth/facebook/callback`,
    state,
    scope: 'public_profile,email,pages_show_list,pages_read_engagement,pages_manage_engagement,pages_manage_posts,pages_read_user_content,ads_read',
    response_type: 'code',
  });

  res.redirect(`https://www.facebook.com/v18.0/dialog/oauth?${params}`);
});

// Facebook OAuth flow - Step 2: Handle callback and exchange code for token
router.get('/facebook/callback', async (req, res) => {
  const { code, state, error, error_reason } = req.query;

  if (error) {
    return res.redirect(`${config.frontendUrl}/?error=${encodeURIComponent(error_reason || error)}`);
  }

  const savedState = req.session?.facebookOAuthState;
  if (!savedState || savedState !== state) {
    return res.status(401).send('Invalid state');
  }

  if (!code) {
    return res.redirect(`${config.frontendUrl}/?error=missing_code`);
  }

  try {
    // Exchange code for access token
    const { data: tokenData } = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        client_id: config.facebook.appId,
        client_secret: config.facebook.appSecret,
        redirect_uri: `${config.frontendUrl}/api/auth/facebook/callback`,
        code,
      },
    });

    const shortLivedToken = tokenData.access_token;

    // Exchange for long-lived token (60 days)
    const longLivedResult = await exchangeToken(shortLivedToken);
    const accessToken = longLivedResult.access_token || shortLivedToken;
    const expiresIn = longLivedResult.expires_in || tokenData.expires_in || 5184000;

    // Get user profile
    const profile = await verifyFacebookToken(accessToken);
    if (!profile) {
      return res.redirect(`${config.frontendUrl}/?error=invalid_token`);
    }

    const { id: facebookId, name, picture } = profile;

    // Get pages list
    const pages = await getPages(accessToken);

    // Store token and pages in session for page selection
    req.session.facebookAccessToken = accessToken;
    req.session.facebookId = facebookId;
    req.session.facebookProfile = { name, picture };
    req.session.facebookPages = pages;
    req.session.facebookTokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
    delete req.session.facebookOAuthState;

    req.session.save((err) => {
      if (err) {
        return res.redirect(`${config.frontendUrl}/?error=${encodeURIComponent(err.message)}`);
      }
      // Redirect to page selection page
      res.redirect(`${config.frontendUrl}/facebook/select-page`);
    });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.redirect(`${config.frontendUrl}/?error=${encodeURIComponent(msg)}`);
  }
});

// Get Facebook pages for selection
router.get('/facebook/pages', (req, res) => {
  if (!req.session.facebookPages) {
    return res.status(401).json({ error: 'No Facebook session found. Please sign in again.' });
  }
  res.json({ pages: req.session.facebookPages });
});

// Select Facebook page
router.post('/facebook/select-page', async (req, res) => {
  const { pageId } = req.body;

  if (!req.session.facebookAccessToken || !req.session.facebookId) {
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

    // Find or create user
    let user = await userRepo.findOne({ facebookId });

    const userData = {
      facebookId,
      profile: {
        firstName: name ? name.split(' ')[0] : 'Facebook',
        lastName: name ? name.split(' ').slice(1).join(' ') : 'User',
        profilePicture: picture,
      },
    };

    if (user) {
      user = await userRepo.findByIdAndUpdate(user._id, userData, { new: true });
    } else {
      user = await userRepo.create(userData);
    }

    if (!user) {
      return res.status(500).json({ error: 'Failed to create user record' });
    }

    // Create Integration so keyword polling, posting, etc. work
    await integrationRepo.findOneAndUpdate(
      { userId: user._id, platform: 'facebook' },
      {
        userId: user._id,
        platform: 'facebook',
        platformUserId: facebookId,
        accessToken,
        refreshToken: undefined,
        tokenExpiresAt: tokenExpiresAt,
        facebookPageId: selectedPage.id,
        facebookPageAccessToken: selectedPage.access_token,
        facebookPageName: selectedPage.name,
        profile: { name, profilePicture: picture },
        isActive: true,
        lastUsedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    createSession(req, user);
    saveSessionAndRespond(req, res, { ok: true });
  } catch (err) {
    console.error('Facebook Page Selection Error:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Twitter OAuth flow - Step 1: Get request token
// Twitter OAuth 2.0 flow - Step 1: Redirect to Twitter
router.get('/twitter', async (req, res) => {
  try {
    const state = uuidv4();
    const { verifier, challenge } = generatePKCEChallenge();

    req.session = req.session || {};
    req.session.twitterOAuthState = state;
    req.session.twitterCodeVerifier = verifier;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.twitter.clientId,
      redirect_uri: `${config.frontendUrl}/api/auth/twitter/callback`,
      scope: 'tweet.read tweet.write users.read offline.access',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    res.redirect(`https://twitter.com/i/oauth2/authorize?${params}`);
  } catch (err) {
    res.redirect(`${config.frontendUrl}/?error=${encodeURIComponent(err.message)}`);
  }
});

// Twitter OAuth 2.0 flow - Step 2: Handle callback
router.get('/twitter/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${config.frontendUrl}/?error=${encodeURIComponent(error)}`);
  }

  const savedState = req.session?.twitterOAuthState;
  const codeVerifier = req.session?.twitterCodeVerifier;

  if (!savedState || savedState !== state) {
    return res.status(401).send('Invalid state');
  }

  if (!code || !codeVerifier) {
    return res.redirect(`${config.frontendUrl}/?error=missing_params`);
  }

  try {
    const redirectUri = `${config.frontendUrl}/api/auth/twitter/callback`;
    const tokenData = await exchangeOAuth2Code(code, codeVerifier, redirectUri);

    if (tokenData.error) {
      return res.redirect(`${config.frontendUrl}/?error=${encodeURIComponent(tokenData.error)}`);
    }

    const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = tokenData;

    // Verify credentials and get user info
    const userInfo = await verifyTwitterCredentials(accessToken);

    if (!userInfo) {
      return res.redirect(`${config.frontendUrl}/?error=twitter_verification_failed`);
    }

    const { id: twitterId, username, name, profilePicture } = userInfo;

    // Find or create user
    let user = await userRepo.findOne({ twitterId });

    const userData = {
      twitterId,
      profile: {
        firstName: name ? name.split(' ')[0] : username,
        lastName: name ? name.split(' ').slice(1).join(' ') : '',
        profilePicture: profilePicture || `https://unavatar.io/twitter/${username}`,
      },
    };

    if (!user) {
      user = await userRepo.create(userData);
    }

    // Create or update Twitter Integration (required for keyword polling, posting)
    await integrationRepo.findOneAndUpdate(
      { userId: user._id, platform: 'twitter' },
      {
        userId: user._id,
        platform: 'twitter',
        platformUserId: twitterId,
        platformUsername: username,
        accessToken,
        refreshToken,
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        profile: { name, username, profilePicture },
        isActive: true,
        lastUsedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    createSession(req, user);
    req.session.save((err) => {
      if (err) return res.redirect(`${config.frontendUrl}/?error=${encodeURIComponent(err.message)}`);
      res.redirect(`${config.frontendUrl}/home`);
    });
  } catch (err) {
    res.redirect(`${config.frontendUrl}/?error=${encodeURIComponent(err.message)}`);
  }
});

/**
 * Session sync: Firebase token -> Express session + JWT.
 * Google sign-in only allowed for EXISTING users (signed up with email first).
 * New user creation via Google is prohibited.
 */
router.post('/session', async (req, res) => {
  if (req.session?.userId) {
    const user = await userRepo.findById(req.session.userId);
    if (user) {
      const token = createSession(req, user);
      return saveSessionAndRespond(req, res, { ok: true, token, user: { id: user._id, email: user.email, profile: user.profile } });
    }
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const firebaseToken = authHeader.split('Bearer ')[1];
  try {
    const { verifyFirebaseIdToken } = await import('../services/firebaseTokenVerify.js');
    const decodedToken = await verifyFirebaseIdToken(firebaseToken);
    if (!decodedToken) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    let user = await userRepo.findOne({ firebaseUid: decodedToken.uid });
    if (!user && decodedToken.email) {
      user = await userRepo.findOne({ email: decodedToken.email });
    }

    if (!user) {
      user = await userRepo.create({
        email: decodedToken.email,
        name: decodedToken.name || '',
        firebaseUid: decodedToken.uid,
        profile: {
          profilePicture: decodedToken.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(decodedToken.name || 'User')}&background=random`,
        },
        settings: {
          theme: 'light',
          notifications: true
        }
      });
    }

    if (!user.firebaseUid) {
      user = await userRepo.findByIdAndUpdate(user._id, {
        firebaseUid: decodedToken.uid,
        ...(decodedToken.email && !user.email ? { email: decodedToken.email } : {}),
        ...(decodedToken.name && !user.name ? { name: decodedToken.name } : {}),
      }, { new: true });
    }

    const token = createSession(req, user, decodedToken.uid);
    saveSessionAndRespond(req, res, {
      ok: true,
      token,
      user: { id: user._id, email: user.email, profile: user.profile },
    });
  } catch (err) {
    console.error('Session sync error:', err.message);
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
