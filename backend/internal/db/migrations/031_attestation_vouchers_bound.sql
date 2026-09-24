-- 031_attestation_vouchers_bound.sql
-- Chain-bound quest attestation vouchers (owner ruling O4). The realm's
-- canonical message carries no chain id, so the backend binds each signer key to
-- ONE chain (QUEST_SIGNER_CHAIN_ID) and scopes every stored voucher to that
-- (chain_id, signer_pubkey). A voucher signed by an earlier key or for another
-- chain is never served under the current one, and never blocks re-issuance
-- when a new key is registered (PK below).
--
-- The legacy attestation_vouchers table (016, PK (address, quest_id), no chain,
-- Pearl-era key) is left untouched and is no longer read or written.
CREATE TABLE IF NOT EXISTS attestation_vouchers_bound (
    chain_id      TEXT    NOT NULL,
    signer_pubkey TEXT    NOT NULL,
    address       TEXT    NOT NULL,
    quest_id      TEXT    NOT NULL,
    xp            INTEGER NOT NULL,
    nonce         TEXT    NOT NULL,
    sig_hex       TEXT    NOT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chain_id, signer_pubkey, address, quest_id)
);

CREATE INDEX IF NOT EXISTS idx_attestation_vouchers_bound_address
    ON attestation_vouchers_bound (chain_id, signer_pubkey, address);
