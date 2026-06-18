-- 014_badge_mints_drainer.sql
-- Columns + index the badge-mint drainer needs (Phase 2, D2c manual batch-mint):
-- retry/backoff bookkeeping, the broadcast tx hash, and a fast pending-scan index.

ALTER TABLE badge_mints ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE badge_mints ADD COLUMN last_error TEXT;
ALTER TABLE badge_mints ADD COLUMN tx_hash TEXT;

-- The drainer's hot query is `WHERE mint_status='pending'`; index it
-- (previously only idx_badge_mints_address existed, an address scan).
CREATE INDEX IF NOT EXISTS idx_badge_mints_status ON badge_mints (mint_status);

-- NOTE: the login_streaks table (010_gnobuilders.sql) is unused — login streaks
-- are tracked in frontend localStorage and nothing in Go reads or writes it.
-- Left in place (harmless, empty) and documented here so it isn't mistaken for
-- live state; a later migration may drop it once confirmed safe.
