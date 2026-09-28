-- All v1 block rows must be replayed from a verified source before this
-- migration; MigrateStore refuses an occupied v1 journal rather than
-- inventing an unverified count for existing rows.
ALTER TABLE launchpad_blocks ADD COLUMN num_txs INTEGER NOT NULL DEFAULT 0 CHECK (num_txs >= 0);
