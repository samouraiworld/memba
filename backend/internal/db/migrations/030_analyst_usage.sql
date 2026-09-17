-- Per-wallet daily counter for analyst report generation.
-- One row per (wallet, UTC day); rows older than the current day are purged.
CREATE TABLE IF NOT EXISTS analyst_usage (
    address TEXT NOT NULL,
    day     TEXT NOT NULL,
    count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (address, day)
);
