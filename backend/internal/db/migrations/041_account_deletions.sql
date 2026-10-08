-- Keep a pseudonymous denial marker after account deletion so a still-valid
-- identity-provider session cannot recreate the deleted account. No email,
-- raw subject or consent survives here. No automatic expiry is safe until
-- token/session revocation bounds have been established and approved.
CREATE TABLE IF NOT EXISTS account_deletions (
    subject_digest TEXT PRIMARY KEY,
    deleted_at     TEXT NOT NULL
);
