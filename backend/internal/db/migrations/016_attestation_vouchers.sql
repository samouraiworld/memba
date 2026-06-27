-- 016_attestation_vouchers.sql
-- On-chain quest/XP attestation (Q-05, Track A). When the backend attestation
-- signer is configured (MEMBA_ATTESTATION_SEED), a verified NEW completion also
-- issues a backend-signed voucher here. The user broadcasts it to the
-- memba_quest_attestation_v1 realm (RecordCompletion), which verifies the
-- signature and records the attestation on-chain. The backend never broadcasts.
--
-- One voucher per (address, quest_id) — PK makes issuance idempotent (re-issuing
-- for an already-voucher'd completion is a no-op). The nonce is unique per row.
CREATE TABLE IF NOT EXISTS attestation_vouchers (
    address    TEXT    NOT NULL,
    quest_id   TEXT    NOT NULL,
    xp         INTEGER NOT NULL,
    nonce      TEXT    NOT NULL,
    sig_hex    TEXT    NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (address, quest_id)
);

CREATE INDEX IF NOT EXISTS idx_attestation_vouchers_address
    ON attestation_vouchers (address);
