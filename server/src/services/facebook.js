import axios from 'axios';
import { config } from '../config.js';

/**
 * Verify Facebook Access Token and get User Profile
 * @param {string} accessToken - User access token from frontend
 * @returns {Promise<{ id: string, name: string, email?: string, picture?: string } | null>}
 */
export async function verifyFacebookToken(accessToken) {
    try {
        // 1. Verify the token using debug_token (optional but recommended for security)
        // We can also just call /me directly, if it fails, token is invalid.

        // 2. Fetch User Profile
        const { data } = await axios.get('https://graph.facebook.com/me', {
            params: {
                access_token: accessToken,
                fields: 'id,name,email,picture.type(large)',
            },
            headers: { 'Accept': 'application/json' }
        });

        if (!data || !data.id) return null;

        return {
            id: data.id,
            name: data.name,
            email: data.email,
            picture: data.picture?.data?.url
        };
    } catch (err) {
        console.error('Facebook Token Verification Error:', err.response?.data || err.message);
        return null;
    }
}

/**
 * Get List of Pages the user manages (with Instagram Business Account when linked)
 * @param {string} accessToken
 * @returns {Promise<Array<{id: string, name: string, access_token: string, instagram_business_account?: {id: string, username?: string}>>}
 */
export async function getPages(accessToken) {
    try {
        const { data } = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
            params: {
                access_token: accessToken,
                fields: 'id,name,access_token,category,instagram_business_account{id,username,profile_picture_url}',
            },
        });
        return data.data || [];
    } catch (err) {
        console.error('Error fetching Facebook Pages:', err.response?.data || err.message);
        return [];
    }
}

/**
 * Create a post on Facebook using the selected page
 * @param {string} pageAccessToken - Page access token
 * @param {string} pageId - Page ID to post to
 * @param {string} message - Post content
 * @returns {Promise<{ id?: string, url?: string, error?: string }>}
 */
export async function createPost(pageAccessToken, pageId, message) {
    try {
        if (!pageId || !pageAccessToken) {
            return { error: 'Page ID and access token are required. Please select a page first.' };
        }

        const { data } = await axios.post(`https://graph.facebook.com/${pageId}/feed`, null, {
            params: {
                message,
                access_token: pageAccessToken
            }
        });

        // Construct Permalink Logic
        // For Pages: https://facebook.com/{pageId}/posts/{story_fbid} (id format is pageId_storyFbid)
        const postIdParts = data.id.split('_');
        const storyId = postIdParts.length > 1 ? postIdParts[1] : postIdParts[0];
        const permalink = `https://www.facebook.com/${pageId}/posts/${storyId}`;

        console.log('Created Post Permalink:', permalink);

        return { id: data.id, url: permalink };
    } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        console.error('Facebook Post Error:', msg);
        return { error: msg };
    }
}

/**
 * Create a photo post on Facebook Page
 * @param {string} pageAccessToken - Page access token
 * @param {string} pageId - Page ID to post to
 * @param {string} message - Caption/text for the post
 * @param {string} imageUrl - Public URL of the image (Facebook fetches it)
 * @returns {Promise<{ id?: string, url?: string, error?: string }>}
 */
export async function createPhotoPost(pageAccessToken, pageId, message, imageUrl) {
    try {
        if (!pageId || !pageAccessToken) {
            return { error: 'Page ID and access token are required. Please select a page first.' };
        }
        if (!imageUrl || !imageUrl.startsWith('http')) {
            return { error: 'Image URL must be a public URL' };
        }

        const { data } = await axios.post(`https://graph.facebook.com/${pageId}/photos`, null, {
            params: {
                url: imageUrl,
                caption: message || '',
                access_token: pageAccessToken
            }
        });

        const photoId = data.id;
        const permalink = data.post_id
            ? `https://www.facebook.com/${pageId}/posts/${data.post_id.split('_')[1] || photoId}`
            : `https://www.facebook.com/${pageId}/photos/${photoId}`;

        return { id: photoId, url: permalink };
    } catch (err) {
        let msg = err.response?.data?.error?.message || err.message;
        if (msg && (msg.toLowerCase().includes('url') || msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('invalid'))) {
            msg += ' (Ensure API_PUBLIC_URL is set and ngrok is running so Facebook can fetch the image.)';
        }
        console.error('Facebook Photo Post Error:', msg);
        return { error: msg };
    }
}

/**
 * Exchange short-lived token for long-lived token (60 days)
 * @param {string} shortLivedToken - Short-lived user access token
 * @returns {Promise<{ access_token?: string, expires_in?: number, error?: string }>}
 */
export async function exchangeToken(shortLivedToken) {
    try {
        const { data } = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
            params: {
                grant_type: 'fb_exchange_token',
                client_id: config.facebook.appId,
                client_secret: config.facebook.appSecret,
                fb_exchange_token: shortLivedToken,
            },
        });
        return { 
            access_token: data.access_token, 
            expires_in: data.expires_in 
        };
    } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        console.error('Facebook Token Exchange Error:', msg);
        return { error: msg };
    }
}
