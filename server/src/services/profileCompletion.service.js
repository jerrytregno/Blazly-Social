import * as userRepo from '../db/userRepository.js';
import * as userProfileRepo from '../db/userProfileRepository.js';
import * as competitorRepo from '../db/repositories/competitorRepository.js';
import * as integrationRepo from '../db/repositories/integrationRepository.js';

/**
 * Calculate profile completion percentage.
 * +10% basic info (name)
 * +20% business details
 * +20% own website scraped
 * +20% competitor added
 * +20% integrations connected
 * +10% timezone selected
 * @param {object} user - User object
 * @param {object} [opts] - Optional pre-fetched data to avoid duplicate DB calls
 * @param {object} [opts.profile] - Pre-fetched user profile
 * @param {Array} [opts.competitors] - Pre-fetched competitors
 * @param {Array} [opts.integrations] - Pre-fetched integrations
 */
export async function calculateProfileCompletion(user, opts = {}) {
  if (!user) return 0;

  let completion = 0;
  const userId = user._id;

  // Basic info: name (user.name or profile.firstName+lastName)
  const hasName =
    (user.name && user.name.trim().length > 0) ||
    (user.profile?.firstName || user.profile?.lastName);
  if (hasName) completion += 10;

  // Business details (UserProfile with businessName/summary)
  const profile = opts.profile ?? await userProfileRepo.findOne({ userId });
  if (profile?.businessName || profile?.businessSummary) completion += 20;

  // Own website scraped
  if (profile?.websiteUrl && profile?.lastScrapedAt) completion += 20;

  // Competitor added
  const competitors = opts.competitors ?? await competitorRepo.find({ userId });
  if (competitors.length > 0) completion += 20;

  // Integrations connected
  const integrations = opts.integrations ?? await integrationRepo.find({ userId });
  if (integrations.length > 0) completion += 20;

  // Timezone selected
  if (user.timezone && user.timezone !== 'UTC') completion += 10;

  return Math.min(100, completion);
}
