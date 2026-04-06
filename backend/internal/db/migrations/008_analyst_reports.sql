-- Memba v3.2.0 — Cached AI analyst reports for governance proposals.
CREATE TABLE IF NOT EXISTS analyst_reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    realm_path  TEXT NOT NULL,
    proposal_id INTEGER NOT NULL,
    consensus   TEXT NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME NOT NULL,
    UNIQUE(realm_path, proposal_id)
);

CREATE INDEX IF NOT EXISTS idx_analyst_reports_lookup
    ON analyst_reports (realm_path, proposal_id, expires_at);
