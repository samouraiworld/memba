-- 038_accounts.sql
-- The optional Memba account (off-chain extras only: email, consents). Keyed
-- by an internal id so a change of identity provider rewrites idp/idp_subject
-- and nothing else. The email is stored only once the provider reports it
-- verified. Rows that belong to an account reference it ON DELETE CASCADE, so
-- deleting the account deletes everything it owns.
CREATE TABLE IF NOT EXISTS accounts (
    id                     TEXT PRIMARY KEY,
    idp                    TEXT NOT NULL,
    idp_subject            TEXT NOT NULL,
    email                  TEXT,
    email_verified_at      TEXT,
    email_undeliverable_at TEXT,
    created_at             TEXT NOT NULL,
    UNIQUE (idp, idp_subject)
);
