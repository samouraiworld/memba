-- Durable transient attestation failure count. A process restart must not
-- reset the gas-spending retry limit for a poisoned run.
ALTER TABLE arcade_runs ADD COLUMN attest_failures INTEGER NOT NULL DEFAULT 0;
