-- Rekey the analyst report cache so a shared report is bound to its inputs.
--
-- 008 declared a table-level UNIQUE(realm_path, proposal_id) that 009 could not
-- drop, so reports for different chains on the same realm/proposal evicted each
-- other, and DAO-level reports shared proposal 0's slot. A report is now
-- addressed by realm, analysis type, proposal, chain and a digest of the inputs
-- it was generated from.
--
-- analyst_reports is a disposable cache (6h TTL): existing rows are dropped and
-- regenerate on demand.
DROP TABLE IF EXISTS analyst_reports;

CREATE TABLE analyst_reports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    realm_path    TEXT NOT NULL,
    analysis_type TEXT NOT NULL,
    proposal_id   INTEGER NOT NULL,
    chain_id      TEXT NOT NULL,
    input_digest  TEXT NOT NULL,
    consensus     TEXT NOT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at    DATETIME NOT NULL,
    UNIQUE(realm_path, analysis_type, proposal_id, chain_id, input_digest)
);

CREATE INDEX idx_analyst_reports_lookup
    ON analyst_reports (realm_path, analysis_type, proposal_id, chain_id, input_digest, expires_at);
