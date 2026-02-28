import * as rateLimitRepo from '../db/rateLimitRepository.js';
import { config } from '../config.js';

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export async function getAppUsage() {
  const date = todayUtc();
  const doc = await rateLimitRepo.findOne({ date, key: 'app' });
  return doc ? doc.count : 0;
}

export async function getUserUsage(userId) {
  const date = todayUtc();
  const key = String(userId);
  const doc = await rateLimitRepo.findOne({ date, key });
  return doc ? doc.count : 0;
}

export async function canMakeLinkedInCall(userId) {
  const [appUsage, userUsage] = await Promise.all([
    getAppUsage(),
    getUserUsage(userId),
  ]);
  const appLimit = config.rateLimit.appDailyLimit;
  const userLimit = config.rateLimit.userDailyLimit;
  return appUsage < appLimit && userUsage < userLimit;
}

export async function incrementLinkedInUsage(userId) {
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
}
