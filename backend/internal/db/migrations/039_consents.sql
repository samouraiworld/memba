-- 039_consents.sql
-- Marketing consent for the optional account, append-only: one row per
-- request (the newest row of a topic is its state), each naming the address
-- it was made for and the wording shown. Deleted with the account.
CREATE TABLE IF NOT EXISTS consents (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id       TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    topic            TEXT NOT NULL,
    scope            TEXT NOT NULL DEFAULT '',
    email            TEXT NOT NULL,
    wording_version  TEXT NOT NULL,
    source           TEXT NOT NULL,
    requested_at     TEXT NOT NULL,
    confirmed_at     TEXT,
    withdrawn_at     TEXT,
    withdrawn_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_consents_account_topic ON consents (account_id, topic, id);
CREATE INDEX IF NOT EXISTS idx_consents_email ON consents (email);

-- When the account's stored address last changed: a session issued before it
-- (still valid for a minute) must not change the address back.
ALTER TABLE accounts ADD COLUMN email_changed_at TEXT;
