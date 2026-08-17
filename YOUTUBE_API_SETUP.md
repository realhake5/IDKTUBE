# Enable live YouTube search

The curated feed works without an API key. Live search, channel uploads, and trending videos use the **YouTube Data API v3**.

## 1. Create a browser API key

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.
3. Enable **YouTube Data API v3** under **APIs & Services → Library**.
4. Create an API key under **APIs & Services → Credentials**.
5. Restrict the key to:
   - `http://127.0.0.1:4173/*` for local testing
   - `https://YOUR-USERNAME.github.io/*` for GitHub Pages
   - Your custom domain if you use one
6. Restrict the key to the **YouTube Data API v3** API.

## 2. Add it to idktube

Paste the key into `config.js`:

```js
window.IDKTUBE_CONFIG = {
  youtubeApiKey: 'YOUR_KEY_HERE',
  regionCode: 'US',
};
```

Do not use an unrestricted key. A browser key is visible to visitors by design, so HTTP-referrer and API restrictions are important.

If `youtubeApiKey` is left blank, the first live search asks for a key and stores it in the current browser's local storage instead.

## What is supported

- Search public videos and channels
- Open a channel result and load its public uploads
- Load public trending videos by region
- Play embeddable videos in the existing player

YouTube can still prevent individual videos from playing when the owner disables embedding or applies age, region, sign-in, Premium, or other restrictions. Private account features such as subscriptions, watch history, likes, and personal playlists require Google OAuth and are not available from a public API key alone.
