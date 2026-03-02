import express from 'express';
import { generateContent, getSimilarKeywords } from '../services/gemini.js';
import { generateAndSaveImage } from '../services/imageGen.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.post('/generate-image', requireAuth, async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    const result = await generateAndSaveImage(prompt.trim());
    if (result.error) return res.status(400).json(result);
    // Return base64 – client uploads to Storage (no service account needed)
    res.json({ base64: result.base64 });
  } catch (err) {
    console.error('Generate image error:', err);
    res.status(500).json({ error: err.message || 'Image generation failed' });
  }
});

router.post('/generate', requireAuth, async (req, res) => {
  try {
    const { topic, platform, imagePrompt } = req.body;
    if (!topic) return res.status(400).json({ error: 'Topic is required' });
    const customInstructions = req.user?.aiInstructions;
    const result = await generateContent(topic, platform || 'linkedin', imagePrompt || '', customInstructions);
    if (result.error) return res.status(500).json(result);
    res.json(result);
  } catch (err) {
    console.error('AI Route Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/best-times', requireAuth, (req, res) => {
  const { platform } = req.query;
  const suggestions = {
    linkedin: [
      'Tue–Thu, 8–10 AM or 12 PM — professionals check during morning coffee or lunch',
      'Avoid Mondays and Fridays — lower engagement',
    ],
    twitter: [
      'Wed 9 AM, Thu 9 AM, Fri 9 AM — peak engagement windows',
      '12 PM and 5 PM also perform well for quick scrolls',
    ],
    instagram: [
      'Tue 11 AM, Wed 10 AM, Fri 10 AM — ideal for visual content',
      'Evenings 7–9 PM work well for lifestyle posts',
    ],
    facebook: [
      'Wed 11 AM, Thu 12 PM, Fri 10 AM — midday peaks',
      'Weekday mornings 9–11 AM are solid',
    ],
    threads: [
      'Tue–Thu, 10 AM–12 PM — similar to Instagram best times',
      'Evenings 7–8 PM for casual updates',
    ],
  };
  const times = platform && suggestions[platform]
    ? suggestions[platform]
    : Object.entries(suggestions).flatMap(([p, arr]) => arr.map(t => `[${p}] ${t}`));
  res.json({ suggestions: times });
});

router.get('/keywords/suggest', requireAuth, async (req, res) => {
  try {
    const { q, existing } = req.query;
    const word = (q || '').trim();
    if (!word || word.length < 2) return res.json({ suggestions: [] });
    const existingArr = existing ? String(existing).split(',').map(s => s.trim()).filter(Boolean) : [];
    const suggestions = await getSimilarKeywords(word, existingArr);
    res.json({ suggestions });
  } catch (err) {
    console.error('Keyword suggest error:', err);
    res.status(500).json({ suggestions: [] });
  }
});

router.post('/profile-suggestions', requireAuth, async (req, res) => {
  try {
    const { platform } = req.body || {};
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    const platformName = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'all platforms';
    const result = await model.generateContent(`
Suggest 3-5 concise, actionable profile edit tips for ${platformName} to improve engagement and authenticity.
Return JSON: { "suggestions": ["tip1", "tip2", ...] }
`);
    const text = result.response?.text() || '{}';
    const parsed = JSON.parse(text.replace(/```json?\s*/g, '').trim());
    res.json(parsed.suggestions ? parsed : { suggestions: [] });
  } catch (err) {
    console.error('Profile suggestions error:', err);
    res.status(500).json({ error: 'Failed to generate suggestions', suggestions: [] });
  }
});

export default router;
