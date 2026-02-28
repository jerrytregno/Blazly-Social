import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        // The SDK doesn't have a direct "listModels" on the instance easily accessible in all versions without admin, 
        // but the error message suggested it. 
        // Let's try to just hit the API or use a known working fallback like 'gemini-pro'.

        // Actually, looking at docs/error, let's try to just use 'gemini-pro' as a fallback test or 'gemini-1.0-pro'.
        // But to be precise, let's try to run a script that catches the error and prints more info if possible, 
        // or just try a standard 'gemini-pro' generation to see if that works.

        // Better approach: 
        // The @google/generative-ai SDK usually has a `getGenerativeModel` method.
        // There isn't a simple `listModels` in the high-level client for API keys sometimes.
        // However, I will try to use axios to hit the REST endpoint directly to list models.

        console.log('Fetching available models...');
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
        const data = await response.json();

        if (data.models) {
            console.log('Available Models:');
            data.models.forEach(m => {
                if (m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')) {
                    console.log(`- ${m.name}`);
                }
            });
        } else {
            console.log('No models found or error:', data);
        }

    } catch (error) {
        console.error('Error listing models:', error);
    }
}

listModels();
