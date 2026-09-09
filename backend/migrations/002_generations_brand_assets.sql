-- Migration 002 — run these ONE STATEMENT AT A TIME in the D1 Console
-- (the console silently swallows multi-statement pastes).
-- Safe to re-run: each ALTER fails with "duplicate column name" if already applied,
-- which you can ignore.

ALTER TABLE generations ADD COLUMN output TEXT;

ALTER TABLE generations ADD COLUMN title TEXT;

ALTER TABLE generations ADD COLUMN meta TEXT;

ALTER TABLE generations ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;

ALTER TABLE generations ADD COLUMN updated_at TEXT;

ALTER TABLE posts ADD COLUMN assets TEXT NOT NULL DEFAULT '[]';

ALTER TABLE posts ADD COLUMN format TEXT NOT NULL DEFAULT 'single';

ALTER TABLE posts ADD COLUMN hashtags TEXT NOT NULL DEFAULT '[]';

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

CREATE INDEX IF NOT EXISTS idx_generations_kind ON generations(kind);
