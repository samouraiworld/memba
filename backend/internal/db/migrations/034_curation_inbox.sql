-- 034_curation_inbox.sql
-- Private inbox between a collection's founder and the curation managers: one
-- thread per collection, per chain. Public curation decisions are recorded on
-- chain; this conversation never is.
--
-- body is AES-256-GCM ciphertext and nonce is its nonce. key_id is the
-- fingerprint of the key that sealed the row: a row does not open under any
-- other key. Chain, collection, sender and time stay in clear: access checks
-- and audits read them.
--
-- chain_id leads the primary key and the only other index, so two networks
-- never share a thread, a sequence or an idempotency key.
CREATE TABLE IF NOT EXISTS curation_inbox_messages (
    chain_id   TEXT    NOT NULL,
    collection TEXT    NOT NULL,
    seq        INTEGER NOT NULL CHECK (seq > 0), -- position in the thread, from 1
    sender     TEXT    NOT NULL,
    client_id  TEXT    NOT NULL,                 -- chosen by the sender, so a retried send is stored once
    created_at INTEGER NOT NULL,                 -- Unix seconds
    key_id     TEXT    NOT NULL,
    nonce      BLOB    NOT NULL,
    body       BLOB    NOT NULL,
    PRIMARY KEY (chain_id, collection, seq)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_curation_inbox_client_id
    ON curation_inbox_messages (chain_id, collection, sender, client_id);
