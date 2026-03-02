import * as rateLimitRepo from '../db/rateLimitRepository.js';
import { config } from '../config.js';

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function isCredsError(err) {
  return err?.message?.includes('Could not load the default credentials') || err?.message?.includes('credentials');
}

export async function getAppUsage() {
  try {
    const date = todayUtc();
    const doc = await rateLimitRepo.findOne({ date, key: 'app' });
    return doc ? doc.count : 0;
  } catch (err) {
    if (isCredsError(err)) return 0;
    throw err;
  }
}

export async function getUserUsage(userId) {
  try {
    const date = todayUtc();
    const key = String(userId);
    const doc = await rateLimitRepo.findOne({ date, key });
    return doc ? doc.count : 0;
  } catch (err) {
    if (isCredsError(err)) return 0;
    throw err;
  }
}

export async function canMakeLinkedInCall(userId) {
  try {
    const [appUsage, userUsage] = await Promise.all([
      getAppUsage(),
      getUserUsage(userId),
    ]);
    const appLimit = config.rateLimit.appDailyLimit;
    const userLimit = config.rateLimit.userDailyLimit;
    return appUsage < appLimit && userUsage < userLimit;
  } catch (err) {
    if (isCredsError(err)) return true; // Allow when Firestore unavailable (no rate limiting)
    throw err;
  }
}

export async function incrementLinkedInUsage(userId) {
  try {
    const date = todayUtc();
    await rateLimitRepo.findOneAndUpdate(
      { date, key: 'app' },
      { $inc: { count: 1 } },
      { upsert: true, new: true }
    );
    await rateLimitRepo.findOneAndUpdate(
      { date, key: String(userId) },
      { $inc: { count: 1 } },
      { upsert: true, new: true }
    );
  } catch (err) {
    if (isCredsError(err)) return; // No-op when Firestore unavailable
    throw err;
  }
}
