-- Per-signature A3 verification verdict. During the log-only rollout window
-- (MEMBA_ENFORCE_MULTISIG_SIG_VERIFY unset) SignTransaction stores signatures
-- even when server-side verification fails; this column records the verdict so
-- quorum displays can distinguish verified from merely-submitted signatures.
-- FALSE means "stored, not cryptographically verified" — including all rows
-- submitted before this migration.
ALTER TABLE signatures ADD COLUMN verified BOOLEAN NOT NULL DEFAULT FALSE;
