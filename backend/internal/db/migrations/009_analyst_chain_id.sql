-- v3.3: Add chain_id to analyst_reports for network-scoped caching.
-- Existing rows get 'unknown' default — they will be refreshed naturally (6h TTL).
ALTER TABLE analyst_reports ADD COLUMN chain_id TEXT NOT NULL DEFAULT 'unknown';

-- Recreate unique constraint with chain_id (SQLite requires drop+create)
DROP INDEX IF EXISTS idx_analyst_reports_lookup;
CREATE UNIQUE INDEX idx_analyst_reports_unique
    ON analyst_reports (realm_path, proposal_id, chain_id);
CREATE INDEX idx_analyst_reports_lookup
    ON analyst_reports (realm_path, proposal_id, chain_id, expires_at);
