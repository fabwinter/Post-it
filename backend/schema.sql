-- Cloudflare D1 schema for CreateOS. Run once against a new D1 database:
--   wrangler d1 execute <database-name> --remote --file=backend/schema.sql
-- or paste this into the D1 database's Console tab in the Cloudflare dashboard
-- ONE STATEMENT AT A TIME (the console swallows multi-statement pastes).
--
-- Already have an older database? Don't re-run this file — run
-- backend/migrations/002_generations_brand_assets.sql instead.

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Untitled post',
  content TEXT NOT NULL DEFAULT '',
  platforms TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_time TEXT,
  media_urls TEXT NOT NULL DEFAULT '[]',
  media_type TEXT,
  -- assets is the multi-slide model: a JSON array of either
  --   {"type":"image|video|audio","url":"https://…","caption":"…"}  (generated media)
  -- or {"type":"visual","spec":{template,theme,…},"caption":"…"}    (rendered client-side)
  -- Rendered visuals are stored as their spec, never as a base64 PNG — a D1 row
  -- cannot hold ten 1080px data URLs.
  assets TEXT NOT NULL DEFAULT '[]',
  format TEXT NOT NULL DEFAULT 'single',
  hashtags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);

-- Every AI generation lands here, text ones included. Media generations carry a
-- PoYo task_id and fill `files` once the task finishes; text generations use an
-- empty task_id and put their result in `output`.
CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,
  files TEXT NOT NULL DEFAULT '[]',
  progress INTEGER DEFAULT 0,
  error_message TEXT,
  output TEXT,
  title TEXT,
  meta TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_generations_status ON generations(status);
CREATE INDEX IF NOT EXISTS idx_generations_task_id ON generations(task_id);
CREATE INDEX IF NOT EXISTS idx_generations_kind ON generations(kind);

-- Platform connections. Rows are only ever "connected" once real OAuth lands
-- (Phase 1) — until then GET /api/connections reports every platform as
-- not_connected without needing a row here at all.
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL UNIQUE,
  account_name TEXT,
  status TEXT NOT NULL DEFAULT 'not_connected',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One row per brand. The kit feeds copy prompts, image prompts and the visual
-- renderer so generated posts come out on-brand instead of generic.
CREATE TABLE IF NOT EXISTS brand_kits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Default brand',
  is_default INTEGER NOT NULL DEFAULT 1,
  colors TEXT NOT NULL DEFAULT '{}',
  fonts TEXT NOT NULL DEFAULT '{}',
  logo_url TEXT,
  handle TEXT,
  voice TEXT,
  audience TEXT,
  hashtags TEXT NOT NULL DEFAULT '[]',
  cta TEXT,
  banned_words TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
