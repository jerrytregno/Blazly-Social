import { GoogleGenerativeAI } from '@google/generative-ai';

// Platform-specific guidelines for AI-generated content
const PLATFORM_GUIDELINES = {
  linkedin: {
    tone: 'professional, insightful, thought-leadership. Sound like an expert sharing value.',
    maxLength: 3000,
    hashtags: '2-5 relevant hashtags, professional',
    hooks: 'Avoid "In today\'s fast-paced world...". Use a question, insight, or story.',
  },
  twitter: {
    tone: 'punchy, concise, witty. Every word counts.',
    maxLength: 280,
    hashtags: '1-3 trending hashtags, brief',
    hooks: 'Strong hook in first line. Use line breaks for impact.',
  },
  instagram: {
    tone: 'engaging, visual storytelling. Emoji-friendly but balanced.',
    maxLength: 2200,
    hashtags: '5-15 relevant hashtags for discoverability',
    hooks: 'Hook in first line. Call-to-action at the end.',
  },
  facebook: {
    tone: 'conversational, relatable, community-focused.',
    maxLength: 500,
    hashtags: 'Optional, 0-5 if used',
    hooks: 'Personal, shareable. Ask questions to boost engagement.',
  },
  threads: {
    tone: 'casual, conversational, similar to Twitter but slightly more relaxed.',
    maxLength: 500,
    hashtags: '1-5 if relevant',
    hooks: 'Casual opening. Can use more context than Twitter.',
  },
};

const getPlatformGuidelines = (platform) => {
  return PLATFORM_GUIDELINES[platform] || PLATFORM_GUIDELINES.linkedin;
};

// Initialize the Google Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function generateContent(topic, platform = 'linkedin', imagePrompt = '', customInstructions = null) {
  try {
    const guidelines = getPlatformGuidelines(platform);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);

    const userInstructions = customInstructions?.useGlobalForAll && customInstructions?.global
      ? customInstructions.global
      : (customInstructions?.platforms?.[platform] || customInstructions?.global || '');

    const systemPrompt = `
You are an expert social media manager and copywriter. Create highly engaging, human-sounding content for ${platformName}.
${userInstructions ? `\nCUSTOM INSTRUCTIONS (follow these): ${userInstructions}\n` : ''}

PLATFORM: ${platformName}
TONE: ${guidelines.tone}
MAX LENGTH: ${guidelines.maxLength} characters - NEVER exceed this.
HASHTAGS: ${guidelines.hashtags}
HOOKS: ${guidelines.hooks}

GENERAL RULES:
- Sound authentically human, not robotic or generic AI.
- Use varied sentence lengths. Be punchy.
- Use emojis sparingly and appropriately for the platform (${platform}).
- Focus on value, insights, or storytelling.

FORMAT - Return JSON ONLY, no markdown:
{ "content": "The post text...", "hashtags": ["#tag1", "#tag2"], "imageKeyword": "search term for unsplash" }

- "content": The post text, strictly under ${guidelines.maxLength} chars for ${platform}.
- "hashtags": Array of relevant hashtags.
- "imageKeyword": ${imagePrompt ? `User context: "${imagePrompt}". Convert to a single Unsplash search term.` : 'Single visual search term for high-quality stock photo (e.g. "modern office desk", "team collaboration").'}
`;

    const userPrompt = `TOPIC: ${topic}\nPLATFORM: ${platform}`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n' + userPrompt }] }],
      generationConfig: {
        temperature: 0.8,
        responseMimeType: 'application/json',
      },
    });

    const response = await result.response;
    const text = response.text();
    const parsed = JSON.parse(text);

    // Ensure content respects platform limits
    if (parsed.content && parsed.content.length > guidelines.maxLength) {
      parsed.content = parsed.content.substring(0, guidelines.maxLength - 3) + '...';
    }

    return parsed;
  } catch (error) {
    console.error('Gemini Generation Error:', error);
    return {
      error: 'Failed to generate content. Please ensure your API key is valid and the model is available.',
      details: error.message,
    };
  }
}

/**
 * Analyze scraped website content for brand profile extraction
 */
export async function analyzeBrandFromScraped(extractedText, websiteUrl) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    const prompt = `
You are a brand analyst. Given the scraped content from a company website, extract and rephrase a professional brand summary.

WEBSITE: ${websiteUrl}
SCRAPED CONTENT:
${extractedText.substring(0, 15000)}

Return JSON ONLY, no markdown:
{
  "businessName": "company or brand name extracted from the site",
  "businessSummary": "2-4 sentence professional summary of what this business does",
  "brandTone": "e.g. professional, casual, innovative, trustworthy",
  "keywords": ["keyword1", "keyword2", "keyword3", "..."],
  "industry": "industry or vertical",
  "targetAudience": "brief description of target audience",
  "valueProposition": "what makes them unique or their core value"
}
`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.5,
        responseMimeType: 'application/json',
      },
    });

    const text = (await result.response).text();
    return JSON.parse(text);
  } catch (error) {
    console.error('Gemini Brand Analysis Error:', error);
    return { error: error.message };
  }
}

/**
 * Analyze competitor website for strategic comparison
 */
export async function analyzeCompetitorFromScraped(extractedText, competitorName, competitorUrl, userBrandContext = '') {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    const prompt = `
You are a competitive intelligence analyst. Analyze this competitor's website and extract structured insights.

COMPETITOR: ${competitorName}
URL: ${competitorUrl}
${userBrandContext ? `\nUSER'S BUSINESS CONTEXT (for comparison):\n${userBrandContext}\n` : ''}

SCRAPED CONTENT:
${extractedText.substring(0, 15000)}

Return JSON ONLY, no markdown. Be thorough and detailed. Extract everything you can from the content:
{
  "ideology": "detailed description of their core belief, mission, values, and philosophy",
  "positioning": "how they position themselves: target segment, value prop, competitive stance",
  "strengths": ["strength1", "strength2", "strength3", "strength4", "strength5"],
  "differentiators": ["differentiator1", "differentiator2", "differentiator3"],
  "sustainabilityModel": "detailed: revenue model, growth strategy, retention approach, scalability",
  "messagingTone": "specific tone, vocabulary, emotional appeals, CTAs used",
  "contentStyle": "format (video/text), frequency cues, visual identity, content pillars",
  "keyProducts": ["product1", "product2", "..."],
  "pricingStrategy": "freemium, enterprise, transparent, etc",
  "targetAudience": "specific audience segments they target",
  "technicalStack": "any tech/stack signals if visible",
  "socialProof": "testimonials, case studies, metrics highlighted",
  "strengthsVsYou": "detailed strategic comparison vs user's business",
  "opportunityGap": "specific gaps, weaknesses, or opportunities to exploit"
}
`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.5,
        responseMimeType: 'application/json',
      },
    });

    const text = (await result.response).text();
    return JSON.parse(text);
  } catch (error) {
    console.error('Gemini Competitor Analysis Error:', error);
    return { error: error.message };
  }
}

/**
 * Analyze competitor social media activity from scraped platform data
 * @param {string} competitorName
 * @param {object} platformData - { linkedin: { followers, posts, url }, ... }
 * @returns {Promise<{ summary, postFrequency, engagementLevel }>}
 */
export async function analyzeCompetitorSocialFromData(competitorName, platformData) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    const prompt = `
You are a social media analyst. Based on the following scraped data from ${competitorName}'s social profiles, write a brief activity report.

PLATFORM DATA (followers, posts, etc. - may be partial):
${JSON.stringify(platformData, null, 2)}

Return JSON ONLY:
{
  "summary": "2-4 sentence overview of how active they are across platforms, engagement level, and notable patterns",
  "postFrequency": "e.g. Daily, 2-3x/week, Weekly, Low activity, Unknown",
  "engagementLevel": "e.g. High, Medium, Low, Unknown - based on follower/post ratios if available"
}
`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: 'application/json',
      },
    });

    const text = (await result.response).text();
    return JSON.parse(text);
  } catch (error) {
    console.error('Gemini Social Activity Analysis Error:', error);
    return { summary: 'Analysis unavailable.', postFrequency: 'Unknown', engagementLevel: 'Unknown' };
  }
}

/**
 * Get similar/relevant keywords for a given word (for keyword picker suggestions)
 */
export async function getSimilarKeywords(word, existingKeywords = []) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    const prompt = `
Given the keyword or partial word: "${word}"
${existingKeywords.length ? `User already has: ${existingKeywords.join(', ')}` : ''}

Return 6-10 similar, related, or suggested keywords that a business/social media user might add.
Format: JSON array only, no other text.
Example: ["marketing", "content", "branding", "SEO", "growth"]

Return:`;
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: 'application/json',
      },
    });
    const text = (await result.response).text();
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : (parsed.keywords || parsed.suggestions || []);
    return arr.filter(Boolean).map(String).slice(0, 10);
  } catch (error) {
    console.error('Gemini keyword suggestions:', error.message);
    return [];
  }
}

/**
 * Generate multiple content ideas from trends + keywords (non-persisted, varies by time)
 * @param {string[]} keywords
 * @param {object} trendData
 * @param {string} businessContext
 * @param {string} customInstruction - Optional user custom instruction
 * @returns {Promise<{ ideas: Array<{ title, postIdea, trend, platform, contentType }> }>}
 */
export async function generateContentIdeas(keywords, trendData, businessContext = '', customInstruction = '') {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    const timeContext = new Date().toISOString().slice(0, 13); // hour granularity for variety
    const prompt = `
You are a social media strategist. Generate 3–5 actionable post ideas based on trending topics.
Suggestions should feel fresh and reflect what is relevant right now. Vary angles and platforms.

KEYWORDS: ${keywords.join(', ')}
TREND DATA: ${JSON.stringify(trendData, null, 2)}
${businessContext ? `\nBUSINESS CONTEXT:\n${businessContext}\n` : ''}
${customInstruction ? `\nCUSTOM INSTRUCTIONS (follow these): ${customInstruction}\n` : ''}
TIME CONTEXT (for variety): ${timeContext}

PLATFORM-SPECIFIC CONTENT TYPES:
- linkedin, twitter, facebook, threads: "text" (text post, optionally with image)
- instagram: "reel" (short-form video idea) OR "image" (carousel/single image idea) - always specify which
- For Instagram, include contentType and a brief note on format (e.g. "Reel: 15-30 sec hook + CTA" or "Image: Before/after carousel")

Return JSON ONLY, no markdown:
{
  "ideas": [
    {
      "title": "Short catchy title",
      "postIdea": "One actionable post idea or prompt for content generation",
      "trend": "The trend this ties to",
      "platform": "linkedin|twitter|instagram|facebook|threads",
      "contentType": "text|reel|image"
    }
  ]
}
`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
        responseMimeType: 'application/json',
      },
    });

    const text = (await result.response).text();
    return JSON.parse(text);
  } catch (error) {
    console.error('Gemini Content Ideas Error:', error);
    return { ideas: [], error: error.message };
  }
}

/**
 * Generate trend-based post ideas from trend data
 */
export async function generateTrendIdeas(keywords, trendData, businessContext = '') {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    const prompt = `
You are a social media strategist. Generate actionable post ideas based on trending topics.

KEYWORDS: ${keywords.join(', ')}
TREND DATA: ${JSON.stringify(trendData, null, 2)}
${businessContext ? `\nBUSINESS CONTEXT:\n${businessContext}\n` : ''}

Return JSON ONLY, no markdown:
{
  "postIdea": "One actionable post idea that ties the trend to the keywords",
  "strategySuggestion": "Brief strategy suggestion for riding this trend",
  "alertMessage": "Short alert-style message suitable for notifications"
}
`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: 'application/json',
      },
    });

    const text = (await result.response).text();
    return JSON.parse(text);
  } catch (error) {
    console.error('Gemini Trend Ideas Error:', error);
    return { error: error.message };
  }
}
