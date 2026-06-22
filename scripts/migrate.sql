-- ConvertX — Database Setup
-- Run this SQL in your PostgreSQL database (Neon, Supabase, or Render PostgreSQL).

CREATE TABLE IF NOT EXISTS conversions (
  id             SERIAL PRIMARY KEY,
  url            TEXT NOT NULL,
  output_format  TEXT NOT NULL,
  quality        TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  progress       INTEGER NOT NULL DEFAULT 0,
  download_url   TEXT,
  file_size      INTEGER,
  error_message  TEXT,
  video_title    TEXT,
  video_thumbnail TEXT,
  ip_address     TEXT,
  file_path      TEXT,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blog_posts (
  id               SERIAL PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  excerpt          TEXT,
  content          TEXT NOT NULL,
  category         TEXT,
  tags             TEXT[],
  published        BOOLEAN NOT NULL DEFAULT FALSE,
  meta_title       TEXT,
  meta_description TEXT,
  cover_image      TEXT,
  reading_time     INTEGER,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS faq_items (
  id         SERIAL PRIMARY KEY,
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  category   TEXT,
  "order"    INTEGER NOT NULL DEFAULT 0,
  published  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics (
  id         SERIAL PRIMARY KEY,
  event      TEXT NOT NULL,
  metadata   TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed default FAQ items
INSERT INTO faq_items (question, answer, category, "order", published) VALUES
  ('What video platforms are supported?',
   'YouTube, Twitter/X, TikTok, Instagram, Vimeo, Facebook, Dailymotion, Reddit, Twitch, and hundreds more via yt-dlp.',
   'General', 1, true),
  ('What output formats are available?',
   'MP4 video (360p–1080p), MP3 audio, M4A audio, and WebM video.',
   'Formats', 2, true),
  ('Is there a file size limit?',
   'No limits. Files are streamed directly from our server to your device.',
   'General', 3, true),
  ('How do I access the admin panel?',
   'Visit /admin and log in with: admin / admin123. Update these credentials in production.',
   'Admin', 4, true)
ON CONFLICT DO NOTHING;
