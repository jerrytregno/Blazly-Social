import * as integrationRepo from '../db/repositories/integrationRepository.js';
import * as userProfileRepo from '../db/userProfileRepository.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';

/** Platform permissions for API management reference */
export const PLATFORM_PERMISSIONS = {
  facebook: {
    permissions: ['public_profile', 'email', 'pages_show_list', 'pages_read_engagement', 'pages_manage_engagement', 'pages_manage_posts', 'pages_read_user_content'],
    public_profile_desc: 'public_profile: Default Public Profile Fields (id, name, profile picture). pages_read_engagement: Read Page posts, followers, insights. pages_manage_engagement: Create, edit, delete comments on the Page. pages_read_user_content: Page about/description.',
  },
  linkedin: {
    permissions: ['w_member_social', 'openid', 'profile'],
    profile_desc: 'Read professional profile (name, headline, picture).',
  },
  twitter: {
    permissions: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    profile_desc: 'Read user profile (name, username, bio, profile image).',
  },
  instagram: {
    permissions: ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_comments', 'instagram_business_manage_insights'],
    profile_desc: 'Access business account (linked via Facebook Page). instagram_manage_comments / instagram_business_manage_comments: Create, delete, hide comments; read and respond to mentions.',
  },
  threads: {
    permissions: ['threads_basic', 'threads_content_publish', 'threads_manage_replies'],
    profile_desc: 'Read profile (username, biography, profile picture). threads_manage_replies: Create replies, hide/unhide replies, control who can reply.',
  },
};

/**
 * Fetch Facebook Page profile (about, description) for optimization
 */
async function getFacebookPageProfile(pageId, pageAccessToken) {
  try {
    const { data } = await axios.get(`https://graph.facebook.com/v18.0/${pageId}`, {
      params: {
        access_token: pageAccessToken,
        fields: 'name,about,description,category,website',
      },
    });
    return {
      name: data.name,
      about: data.about,
      description: data.description,
      category: data.category,
      website: data.website,
    };
  } catch (err) {
    console.error('Facebook Page profile fetch error:', err.response?.data || err.message);
    return null;
  }
}

/**
 * Generate AI-powered profile optimization suggestions for a platform
 */
async function generatePlatformSuggestions(platform, integrationProfile, businessProfile, platformCurrentData = {}) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);

    const businessContext = businessProfile
      ? `Business: ${businessProfile.businessName || 'N/A'}
Summary: ${businessProfile.businessSummary || 'N/A'}
Tone: ${businessProfile.brandTone || 'N/A'}
Target audience: ${businessProfile.targetAudience || 'N/A'}
Value proposition: ${businessProfile.valueProposition || 'N/A'}
Keywords: ${(businessProfile.keywords || []).join(', ') || 'N/A'}`
      : 'No business profile set. Suggest completing Business Profile section first.';

    const currentProfile = `Connected profile: ${integrationProfile?.name || 'N/A'}, @${integrationProfile?.username || 'N/A'}
Platform-specific data: ${JSON.stringify(platformCurrentData)}`;

    const prompt = `You are a social media profile optimizer. Suggest 3-5 specific, actionable profile improvements for ${platformName}.

CONTEXT:
${businessContext}

CURRENT PROFILE:
${currentProfile}

Requirements:
- Be platform-specific (${platformName} has different best practices than others).
- For Facebook Pages: suggest optimizing About, Description, Category. Mention public_profile permission reads user data.
- For LinkedIn: suggest headline, summary, experience alignment.
- For Twitter/X: suggest bio, pinned tweet, profile image.
- For Instagram: suggest bio, link, highlight covers.
- For Threads: suggest bio, link in bio.

Return JSON ONLY, no markdown:
{
  "suggestions": [
    {
      "field": "field name",
      "current": "current value or empty",
      "suggested": "improved value",
      "reason": "brief reason for this improvement"
    }
  ]
}`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: 'application/json',
      },
    });

    const text = result.response?.text() || '{}';
    const parsed = JSON.parse(text.replace(/```json?\s*/g, '').trim());
    return parsed.suggestions || [];
  } catch (err) {
    console.error('Profile optimizer AI error:', err);
    return [];
  }
}

/**
 * Get profile optimization suggestions for a user's connected platforms
 */
export async function getProfileOptimizerSuggestions(userId, platformFilter = null) {
  const integrations = await integrationRepo.find({ userId, isActive: true });
  const businessProfile = await userProfileRepo.findOne({ userId });

  const results = [];

  for (const int of integrations) {
    if (platformFilter && int.platform !== platformFilter) continue;

    let platformCurrentData = {};

    if (int.platform === 'facebook' && int.facebookPageId && int.facebookPageAccessToken) {
      platformCurrentData = await getFacebookPageProfile(int.facebookPageId, int.facebookPageAccessToken) || {};
    }

    const suggestions = await generatePlatformSuggestions(
      int.platform,
      int.profile,
      businessProfile,
      platformCurrentData
    );

    results.push({
      platform: int.platform,
      platformName: int.platform.charAt(0).toUpperCase() + int.platform.slice(1),
      profile: int.profile,
      pageName: int.facebookPageName || null,
      currentData: platformCurrentData,
      suggestions,
      permissions: PLATFORM_PERMISSIONS[int.platform] || {},
    });
  }

  return results;
}
