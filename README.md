# ConvertX API — Render Deployment Guide

This is the **backend** for ConvertX. Deploy it on Render, then point your Vercel frontend at it.

---

## 1. Create a Database

Use [Neon](https://neon.tech) (free PostgreSQL, works great with Render):
1. Create a new project at neon.tech
2. Copy the connection string
3. Paste it into the **Neon SQL editor** → run `scripts/migrate.sql` to create tables

---

## 2. Deploy to Render

### Option A — render.yaml (easiest)

1. Push this folder to a **GitHub repo**
2. Go to [dashboard.render.com](https://dashboard.render.com) → New → Blueprint
3. Connect the repo — Render will auto-detect `render.yaml`
4. In the "Environment Variables" step, paste your `DATABASE_URL`
5. Click Deploy

### Option B — Manual

1. New → Web Service → connect your repo
2. Set **Build Command**:
   ```
   npm install && mkdir -p bin && curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp && chmod +x bin/yt-dlp
   ```
3. Set **Start Command**: `npm start`
4. Add environment variable: `DATABASE_URL` = your Neon connection string
5. Deploy

---

## 3. Note Your Render URL

After deployment completes, copy your URL — it looks like:
```
https://convertx-api-xxxx.onrender.com
```

You'll paste this into the Vercel frontend's `vercel.json` next.

---

## 4. "Sign in to confirm you're not a bot"

This is YouTube's bot detection. yt-dlp's `android` player client (already configured) bypasses it in most cases. If it still occurs on high-traffic deployments, add a `YTDLP_COOKIES_FILE` env var pointing to a Netscape-format `cookies.txt` exported from your browser.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `PORT` | Auto | Set by Render automatically |
| `NODE_ENV` | ✅ | Set to `production` |
| `CORS_ORIGIN` | Optional | Your Vercel URL (or `*` for all) |
| `YTDLP_COOKIES_FILE` | Optional | Path to YouTube cookies.txt file |
| `YTDLP_PATH` | Optional | Custom yt-dlp binary path |

---

## Local Development

```bash
npm install

# Download yt-dlp locally
mkdir -p bin
curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp
chmod +x bin/yt-dlp

cp .env.example .env
# Fill in DATABASE_URL

npm run dev
# API available at http://localhost:10000
```
