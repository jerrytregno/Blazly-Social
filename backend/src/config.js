import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/blazly',
  frontendUrl: process.env.FRONTEND_URL || 'https://localhost:5173',
  uploadBaseUrl: process.env.UPLOAD_BASE_URL || '',
  // Public base URL for API (e.g. https://yourapp.com or https://xxx.ngrok.io). Required for Instagram/LinkedIn to fetch images.
  apiPublicUrl: process.env.API_PUBLIC_URL || '',
  linkedin: {
    clientId: process.env.LINKEDIN_CLIENT_ID || '86swiutwriegdi',
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    // Use frontend origin so the OAuth callback is proxied and the session cookie is set for the app origin (fixes 401 when posting)
    redirectUri: process.env.LINKEDIN_REDIRECT_URI || `${process.env.FRONTEND_URL || 'https://localhost:5173'}/api/auth/linkedin/callback`,
    scope: process.env.LINKEDIN_SCOPE || 'w_member_social openid profile',
  },
  facebook: {
    appId: process.env.FACEBOOK_APP_ID,
    appSecret: process.env.FACEBOOK_APP_SECRET,
    configId: process.env.FACEBOOK_CONFIG_ID,
  },
  twitter: {
    clientId: process.env.TWITTER_CLIENT_ID || 'ZmpBMEZpWEdvcFhiLXdzMHpKVFI6MTpjaQ',
    clientSecret: process.env.TWITTER_CLIENT_SECRET || '1PUtmLVmehe7uHuQdgwY4LUm40IEB_PmaXDaOw6vxyAwo3UNd3',
    bearerToken: process.env.TWITTER_BEARER_TOKEN || 'AAAAAAAAAAAAAAAAAAAAAMaw7QEAAAAA3GGpGBJH5P71ER3gcLz7291SVmg%3DAW1qdemh3EcB8IoFKEb6dKMEyU76J7NXluM8LoDLoZBH4lBCbL',
  },
  threads: {
    appId: process.env.THREADS_APP_ID,
    appSecret: process.env.THREADS_APP_SECRET,
    redirectUri: process.env.THREADS_REDIRECT_URI || `${process.env.FRONTEND_URL || 'https://localhost:5173'}/api/auth/integrations/threads/callback`,
  },
  instagram: {
    appId: process.env.INSTAGRAM_LOGIN_APP_ID || '947447064275574',
    appSecret: process.env.INSTAGRAM_LOGIN_APP_SECRET || '8f6090753f492441e74755d4e4c20c9e',
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
  firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT,
  firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
};
