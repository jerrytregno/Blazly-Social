/**
 * Express app – used by both dev server (server/index.js) and Vercel (src/server.js).
 * Does NOT call listen(), connectDb(), or startScheduler().
 */
import './firebase.js'; // Initialize Firestore (no firebase-admin)
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import expressSession from 'express-session';
import { connectDb } from './db.js';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import authIntegrationsRoutes from './routes/auth-integrations.js';
import integrationsRoutes from './routes/integrations.js';
import meRoutes from './routes/me.js';
import postsRoutes from './routes/posts.js';
import aiRoutes from './routes/ai.js';
import uploadRoutes from './routes/upload.js';
import trendsRoutes from './routes/trends.js';
import profileRoutes from './routes/profile.js';
import onboardingRoutes from './routes/onboarding.js';
import schedulingRoutes from './routes/scheduling.js';
import inboxRoutes from './routes/inbox.js';
import reportsRoutes from './routes/reports.js';
import keywordPollRoutes from './routes/keywordPoll.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('trust proxy', 1);

// DB connect - optional when no service account (client-side Firestore mode)
let _dbReady = false;
app.use(async (req, res, next) => {
  if (!_dbReady) {
    try {
      await connectDb();
    } catch (e) {
      console.warn('Firestore not available (no credentials). Using client-side Firestore mode.');
    }
    _dbReady = true;
  }
  next();
});

const ALLOWED_ORIGINS = [
  config.frontendUrl,
  'https://social.blazly.ai',
  'https://social.blazly.ai',
  'http://social.blazly.ai',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow same-origin requests (origin is undefined) and whitelisted origins
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

// Legacy: /uploads for backward compat (old posts). New uploads go to Firebase Storage.
const uploadsPath = path.resolve(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsPath));

const sessionOpts = {
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  name: 'blazly.sid',
  cookie: {
    maxAge: config.session.cookieMaxAge,
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    ...(config.nodeEnv === 'development' && { domain: 'localhost' }),
  },
};
app.use(expressSession(sessionOpts));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api', apiLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/auth/integrations', authIntegrationsRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/me', meRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/trends', trendsRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/scheduling', schedulingRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/keyword-poll', keywordPollRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Production: serve built frontend from public/ (Vercel) or client/dist (local)
if (config.nodeEnv === 'production') {
  const clientDist = path.resolve(__dirname, '../../public');
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

export default app;
