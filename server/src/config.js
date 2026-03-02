import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  // Firebase/Firestore - set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH
  // Dev: Vite at 5173. Production: set FRONTEND_URL to your app URL (e.g. https://yourapp.com) when same-origin
  frontendUrl: process.env.FRONTEND_URL || 'https://localhost:5173',
  uploadBaseUrl: process.env.UPLOAD_BASE_URL || '',
  // Public base URL for API (e.g. https://yourapp.com or https://xxx.ngrok.io). Required for Instagram/LinkedIn to fetch images.
  apiPublicUrl: process.env.API_PUBLIC_URL || '',
  linkedin: {
    clientId: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    redirectUri: process.env.LINKEDIN_REDIRECT_URI || `${process.env.FRONTEND_URL || 'https://localhost:5173'}/api/auth/linkedin/callback`,
    scope: process.env.LINKEDIN_SCOPE || 'w_member_social openid profile',
  },
  // LinkedIn Community Management API App (App B) — for analytics + comments only.
  // This app is NOT used for OAuth login. App A (linkedin above) handles login/posting.
  // Once LinkedIn enables this app, users re-connect LinkedIn to get tokens with the
  // extra scopes: r_organization_social, w_organization_social, r_member_postAnalytics.
  // Until then, analytics endpoints are tried with App A tokens and fail gracefully.
  linkedinCommunity: {
    clientId: process.env.LINKEDIN_COMMUNITY_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_COMMUNITY_CLIENT_SECRET,
    scope: process.env.LINKEDIN_COMMUNITY_SCOPE || 'w_member_social openid profile email r_organization_social w_organization_social r_member_postAnalytics',
  },
  facebook: {
    appId: process.env.FACEBOOK_APP_ID,
    appSecret: process.env.FACEBOOK_APP_SECRET,
    configId: process.env.FACEBOOK_CONFIG_ID,
  },
  twitter: {
    clientId: process.env.TWITTER_CLIENT_ID,
    clientSecret: process.env.TWITTER_CLIENT_SECRET,
    bearerToken: process.env.TWITTER_BEARER_TOKEN,
    // OAuth 1.0a (Consumer Key/Secret) - required for media upload
    apiKey: process.env.TWITTER_API_KEY || process.env.TWITTER_CONSUMER_KEY,
    apiSecret: process.env.TWITTER_API_SECRET || process.env.TWITTER_CONSUMER_SECRET,
  },
  threads: {
    appId: process.env.THREADS_APP_ID,
    appSecret: process.env.THREADS_APP_SECRET,
    redirectUri: process.env.THREADS_REDIRECT_URI || `${process.env.FRONTEND_URL || 'https://localhost:5173'}/api/auth/integrations/threads/callback`,
  },
  instagram: {
    appId: process.env.INSTAGRAM_LOGIN_APP_ID,
    appSecret: process.env.INSTAGRAM_LOGIN_APP_SECRET,
    // Must match Meta App: Instagram > Valid OAuth Redirect URIs. Backend URL avoids proxy/cookie issues.
    redirectUri: process.env.INSTAGRAM_REDIRECT_URI || `http://localhost:${parseInt(process.env.PORT || '4000', 10)}/api/auth/integrations/instagram/callback`,
  },
  rateLimit: {
    appDailyLimit: parseInt(process.env.LINKEDIN_APP_DAILY_LIMIT || '100', 10),
    userDailyLimit: parseInt(process.env.LINKEDIN_USER_DAILY_LIMIT || '15', 10),
  },
  session: {
    secret: process.env.SESSION_SECRET || 'blazly-session-secret-change-in-production',
    cookieMaxAge: 60 * 60 * 24 * 30, // 30 days
  },
  jwt: {
    secret: process.env.JWT_SECRET || process.env.SESSION_SECRET || 'blazly-jwt-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  },
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || 'blazly-social-51a89',
};
