-- Cloudflare D1 schema for CreateOS. Run once against a new D1 database:
--   wrangler d1 execute <database-name> --remote --file=backend/schema.sql
-- or paste this into the D1 database's Console tab in the Cloudflare dashboard.

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Untitled post',
  content TEXT NOT NULL DEFAULT '',
  platforms TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_time TEXT,
  media_urls TEXT NOT NULL DEFAULT '[]',
  media_type TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);

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
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_generations_status ON generations(status);
CREATE INDEX IF NOT EXISTS idx_generations_task_id ON generations(task_id);

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
