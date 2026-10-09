-- Additive, independently deployable Free play preparation. No account-table
-- dependency and no import of legacy daily scores. Migrate applies this even
-- while routes/publication are disabled; keep old binaries rollback-compatible.
CREATE TABLE arcade_freeplay_runs_v2 (
 run_id TEXT PRIMARY KEY,
 chain_id TEXT NOT NULL,
 realm TEXT NOT NULL,
 player TEXT NOT NULL,
 game TEXT NOT NULL,
 client_run_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 record_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('verified','queued','submitted','confirmed')),
 receipt_json TEXT,
 created_at INTEGER NOT NULL,
 UNIQUE(chain_id,realm,player,game,client_run_id)
);
CREATE TABLE arcade_freeplay_quotes_v2 (
 quote_id TEXT PRIMARY KEY,
 run_id TEXT NOT NULL REFERENCES arcade_freeplay_runs_v2(run_id),
 payload_hash TEXT NOT NULL,
 nonce TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL,
 quote_json TEXT NOT NULL,
 consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1))
);
CREATE TABLE arcade_freeplay_outbox_v2 (
 run_id TEXT PRIMARY KEY REFERENCES arcade_freeplay_runs_v2(run_id),
 quote_id TEXT NOT NULL REFERENCES arcade_freeplay_quotes_v2(quote_id),
 nonce TEXT NOT NULL,
 lease_owner TEXT NOT NULL DEFAULT '',
 lease_until INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0,
 tx_hash TEXT NOT NULL DEFAULT '',
 last_error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX arcade_freeplay_scope_v2 ON arcade_freeplay_runs_v2(chain_id,realm,status,created_at);
-- Serialize the actual signer account across games/realms using this DB. An
-- unresolved broadcast pins that signer to its pending run until readback.
CREATE TABLE arcade_freeplay_signers_v2 (
 chain_id TEXT NOT NULL,
 signer TEXT NOT NULL,
 lease_owner TEXT NOT NULL,
 lease_until INTEGER NOT NULL,
 pending_run_id TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(chain_id,signer)
);
