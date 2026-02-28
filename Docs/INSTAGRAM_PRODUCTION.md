# Instagram & Threads Image Posting in Production

## Will it work in production?

**Yes.** When you deploy to production and use a real server URL for `API_PUBLIC_URL`, Meta (Instagram/Threads) can fetch your images successfully.

## Why ngrok free tier fails

- ngrok free tier shows an HTML interstitial page for non-browser requests
- When Meta's servers fetch your image URL, they get HTML instead of the image
- Error: "Only photo or video can be accepted as media type"

## Production setup

1. Deploy your backend to a public URL (e.g. `https://api.yourdomain.com`)
2. Set `API_PUBLIC_URL=https://api.yourdomain.com` in your production `.env`
3. Ensure your `/uploads` route serves images with correct `Content-Type` headers
4. Images will be at URLs like `https://api.yourdomain.com/uploads/filename.png`
5. Meta fetches directly from that URL and receives the image bytes

## Checklist

- [ ] Backend deployed with public HTTPS URL
- [ ] `API_PUBLIC_URL` set to your backend base URL (no trailing slash)
- [ ] `/uploads` directory or storage is publicly readable
- [ ] CORS allows Meta's fetch (or no CORS for GET requests to static files)
