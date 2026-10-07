-- Sign-In with Ethereum: nonces already exchanged for a session. A SIWE
-- challenge is stateless (server-signed), so this table is what makes each
-- signed message single-use, across restarts. A row can be deleted once
-- expires_at (unix seconds) has passed: by then the challenge it came from is
-- refused as expired anyway. Empty unless MEMBA_ENABLE_SIWE is on.
CREATE TABLE IF NOT EXISTS siwe_used_nonces (
    nonce      TEXT    PRIMARY KEY,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_siwe_used_nonces_expires_at
    ON siwe_used_nonces (expires_at);
