-- W2.3 (BE-3): final_hash is client-supplied display/dedup metadata. verified
-- records whether the backend confirmed the hash exists on-chain at completion
-- time (best-effort /tx lookup). FALSE means "claimed by the client,
-- unconfirmed" — including all rows completed before this migration.
ALTER TABLE transactions ADD COLUMN verified BOOLEAN NOT NULL DEFAULT FALSE;
