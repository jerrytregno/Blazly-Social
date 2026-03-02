import axios from 'axios';

/**
 * Generate image from prompt. Returns base64 data URL for client to upload to Storage.
 * No Firebase Admin SDK / service account needed – client uploads directly.
 */
export async function generateAndSaveImage(prompt) {
  const safePrompt = String(prompt || '').trim().slice(0, 500);
  if (!safePrompt) return { error: 'Prompt is required. Describe the image you want.' };

  const modelPrompt = buildImagePrompt(safePrompt);
  console.log('[imageGen] === IMAGE GENERATION REQUEST ===');
  console.log('[imageGen] User prompt (raw):', JSON.stringify(prompt));
  console.log('[imageGen] Final prompt:', JSON.stringify(modelPrompt));

  const key = process.env.GEMINI_API_KEY;

  if (key) {
    const result = await tryGeminiImage(modelPrompt, key);
    if (result) {
      console.log('[imageGen] SUCCESS - returning base64 for client upload');
      return { base64: result };
    }
  } else {
    console.log('[imageGen] GEMINI_API_KEY not set, skipping');
  }

  console.log('[imageGen] All models failed, returning error');
  return { error: 'Image generation failed. Set GEMINI_API_KEY in .env for AI image generation.' };
}

/**
 * Handler: build the final prompt sent to the image model.
 * Passes user prompt through with minimal framing - any requested subject gets generated.
 */
function buildImagePrompt(userPrompt) {
  const p = String(userPrompt || '').trim().slice(0, 500);
  if (!p) return p;
  return `Create an image: ${p}`;
}

/** Gemini image gen. Try multiple models - names vary by region. */
async function tryGeminiImage(prompt, key) {
  const models = ['gemini-2.0-flash-exp-image-generation', 'gemini-2.5-flash-preview-05-20', 'gemini-3-pro-image-preview', 'gemini-2.5-flash'];
  for (const modelId of models) {
    console.log('[imageGen] Trying model:', modelId);
    const url = await tryGeminiImageWithModel(prompt, key, modelId);
    if (url) {
      console.log('[imageGen] Model succeeded:', modelId);
      return url;
    }
    console.log('[imageGen] Model failed/skipped:', modelId);
  }
  return null;
}

async function tryGeminiImageWithModel(prompt, key, modelId) {
  console.log('[imageGen] API base: generativelanguage.googleapis.com/v1beta/models/' + modelId);
  try {
    const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }] };
    const fullUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${key}`;
    const res = await axios.post(fullUrl, body, { timeout: 60000 });
    console.log('[imageGen] API response status:', res.status);
    const candidates = res.data?.candidates;
    const parts = candidates?.[0]?.content?.parts || [];
    console.log('[imageGen] Response candidates:', candidates?.length ?? 0, 'parts:', parts?.length ?? 0);
    parts.forEach((p, i) => {
      const keys = Object.keys(p || {});
      console.log(`[imageGen] Part ${i}: keys=${keys.join(',')}`);
    });
    const imageParts = parts.filter(p => p.inlineData?.data || p.inline_data?.data);
    if (imageParts.length > 0) {
      const lastPart = imageParts[imageParts.length - 1];
      const data = lastPart.inlineData?.data || lastPart.inline_data?.data;
      if (!data) return null;
      return `data:image/png;base64,${data}`;
    }
    console.log('[imageGen] No image parts in response for', modelId);
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    const status = err.response?.status;
    console.error(`[imageGen] Gemini [${modelId}] error:`, status, msg);
  }
  return null;
}
