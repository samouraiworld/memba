-- Memba v5.4.0 — User profiles (editable fields)

CREATE TABLE IF NOT EXISTS profiles (
    address    TEXT PRIMARY KEY,
    bio        TEXT NOT NULL DEFAULT '',
    company    TEXT NOT NULL DEFAULT '',
    title      TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    twitter    TEXT NOT NULL DEFAULT '',
    github     TEXT NOT NULL DEFAULT '',
    website    TEXT NOT NULL DEFAULT '',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
