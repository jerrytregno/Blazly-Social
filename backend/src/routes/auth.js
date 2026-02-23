import { Router } from 'express';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { signToken } from '../services/jwt.js';
import { Integration } from '../models/Integration.js';
import { getMemberId } from '../services/linkedin.js';
import { verifyFacebookToken, getPages, exchangeToken } from '../services/facebook.js';
import { generatePKCEChallenge, exchangeOAuth2Code, verifyTwitterCredentials } from '../services/twitter.js';

const router = Router();
const { linkedin, frontendUrl, session } = config;

// Email/Password Signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const fullName = (name || '').trim();

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const user = await User.create({
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

    req.session.userId = user._id.toString();
    const token = signToken(user._id);
    req.session.save((err) => {
      if (err) return res.status(500).json({ error: 'Session error' });
      res.json({ ok: true, isNew: true, token, user: { id: user._id, email: user.email, profile: user.profile } });
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

    const user = await User.findOne({ email });
    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.session.userId = user._id.toString();
    const token = signToken(user._id);
    req.session.save((err) => {
      if (err) return res.status(500).json({ error: 'Session error' });
      res.json({ ok: true, token, user: { id: user._id, email: user.email, profile: user.profile } });
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
    let user = await User.findOne({ email: profile?.email });
    if (!user) {
      user = await User.create({
        profile: profile
          ? {
            firstName: profile.given_name || profile.localizedFirstName || profile.firstName?.localized?.en_US,
            lastName: profile.family_name || profile.localizedLastName || profile.lastName?.localized?.en_US,
            profilePicture: profile.picture || profile.profilePicture?.displayImage,
          }
          : undefined,
      });
    } else {
      // Update profile if needed
      if (profile) {
        user.profile = {
          firstName: profile.given_name || profile.localizedFirstName || profile.firstName?.localized?.en_US || user.profile?.firstName,
          lastName: profile.family_name || profile.localizedLastName || profile.lastName?.localized?.en_US || user.profile?.lastName,
          profilePicture: profile.picture || profile.profilePicture?.displayImage || user.profile?.profilePicture,
        };
        await user.save();
      }
    }

    // Create or update LinkedIn integration
    await Integration.findOneAndUpdate(
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

    req.session.userId = user._id.toString();
    delete req.session.oauthState;
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
  const cookieName = 'blazly.sid';
  const cookieOpts = { path: '/', httpOnly: true };
  if (process.env.NODE_ENV === 'development') cookieOpts.domain = 'localhost';
  req.session.destroy((err) => {
    res.clearCookie(cookieName, cookieOpts);
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
    scope: 'public_profile,email,pages_show_list,pages_read_engagement,pages_manage_engagement,pages_manage_posts,pages_read_user_content',
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
    let user = await User.findOne({ facebookId });

    const userData = {
      facebookId,
      accessToken,
      tokenExpiresAt,
      facebookPageId: selectedPage.id,
      facebookPageAccessToken: selectedPage.access_token,
      facebookPageName: selectedPage.name,
      profile: {
        firstName: name ? name.split(' ')[0] : 'Facebook',
        lastName: name ? name.split(' ').slice(1).join(' ') : 'User',
        profilePicture: picture,
      },
    };

    if (user) {
      user = await User.findByIdAndUpdate(user._id, userData, { new: true });
    } else {
      try {
        user = await User.create(userData);
      } catch (createErr) {
        if (createErr.code === 11000) {
          if (createErr.keyValue && createErr.keyValue.facebookId) {
            user = await User.findOneAndUpdate(
              { facebookId },
              userData,
              { new: true }
            );
          } else {
            throw createErr;
          }
        } else {
          throw createErr;
        }
      }
    }

    if (!user) {
      return res.status(500).json({ error: 'Failed to create user record' });
    }

    req.session.userId = user._id.toString();
    delete req.session.facebookAccessToken;
    delete req.session.facebookId;
    delete req.session.facebookProfile;
    delete req.session.facebookPages;
    delete req.session.facebookTokenExpiresAt;

    req.session.save((err) => {
      if (err) {
        return res.status(500).json({ error: 'Session error' });
      }
      res.json({ ok: true });
    });
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
    let user = await User.findOne({ twitterId });

    const userData = {
      twitterId,
      profile: {
        firstName: name ? name.split(' ')[0] : username,
        lastName: name ? name.split(' ').slice(1).join(' ') : '',
        profilePicture: profilePicture || `https://unavatar.io/twitter/${username}`,
      },
    };

    if (!user) {
      // Reuse existing logic for user creation/association if needed
      // For now, assume we're tying it to the current session or creating a new user
      user = await User.create(userData);
    }

    // Create or update Twitter integration
    await Integration.findOneAndUpdate(
      { userId: user._id, platform: 'twitter' },
      {
        userId: user._id,
        platform: 'twitter',
        platformUserId: twitterId,
        platformUsername: username,
        accessToken,
        refreshToken,
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        profile: {
          name,
          username,
          profilePicture,
        },
        isActive: true,
        lastUsedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    req.session.userId = user._id.toString();
    delete req.session.twitterOAuthState;
    delete req.session.twitterCodeVerifier;

    req.session.save((err) => {
      if (err) return res.redirect(`${config.frontendUrl}/?error=${encodeURIComponent(err.message)}`);
      res.redirect(`${config.frontendUrl}/home`);
    });
  } catch (err) {
    res.redirect(`${config.frontendUrl}/?error=${encodeURIComponent(err.message)}`);
  }
});

// Session sync: Firebase token -> Express session, or no-op if already have session (MongoDB auth)
router.post('/session', async (req, res) => {
  // If already have MongoDB session, no-op (for email signup/login users)
  if (req.session && req.session.userId) {
    return res.json({ ok: true });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const { auth: firebaseAuth } = await import('../firebase.js');
    if (!firebaseAuth) {
      return res.status(503).json({ error: 'Firebase Auth temporarily unavailable' });
    }
    const decodedToken = await firebaseAuth.verifyIdToken(token);

    let user = await User.findOne({ firebaseUid: decodedToken.uid });
    if (!user) {
      user = await User.create({
        firebaseUid: decodedToken.uid,
        email: decodedToken.email,
        profile: {
          firstName: decodedToken.name?.split(' ')[0] || '',
          lastName: decodedToken.name?.split(' ').slice(1).join(' ') || '',
          profilePicture: decodedToken.picture || '',
        },
      });
    }

    req.session.uid = decodedToken.uid;
    req.session.userId = user._id.toString();
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Session error' });
      }
      res.json({ ok: true, user: { id: user._id, email: user.email, profile: user.profile } });
    });
  } catch (err) {
    console.error('Session sync error:', err.message);
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
