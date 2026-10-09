-- Durable Free play allowance. Depends on 042; applied by db.Migrate even when disabled.
-- Additive, no v1 or existing v2 table altered. Missing migration fails closed.
CREATE TABLE arcade_freeplay_budget_v2 (
 chain_id TEXT NOT NULL,
 signer TEXT NOT NULL,
 day_utc TEXT NOT NULL,
 max_attempts INTEGER NOT NULL CHECK(max_attempts > 0),
 max_fee_ugnot INTEGER NOT NULL CHECK(max_fee_ugnot > 0),
 max_deposit_ugnot INTEGER NOT NULL CHECK(max_deposit_ugnot > 0),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
 fee_ugnot INTEGER NOT NULL DEFAULT 0 CHECK(fee_ugnot >= 0),
 deposit_ugnot INTEGER NOT NULL DEFAULT 0 CHECK(deposit_ugnot >= 0),
 PRIMARY KEY(chain_id, signer, day_utc)
);
CREATE TABLE arcade_freeplay_spending_v2 (
 reservation_id TEXT PRIMARY KEY,
 chain_id TEXT NOT NULL,
 signer TEXT NOT NULL,
 day_utc TEXT NOT NULL,
 run_id TEXT NOT NULL REFERENCES arcade_freeplay_runs_v2(run_id),
 quote_id TEXT NOT NULL REFERENCES arcade_freeplay_quotes_v2(quote_id),
 fee_ugnot INTEGER NOT NULL CHECK(fee_ugnot > 0),
 deposit_ugnot INTEGER NOT NULL CHECK(deposit_ugnot > 0),
 created_at INTEGER NOT NULL,
 FOREIGN KEY(chain_id,signer,day_utc) REFERENCES arcade_freeplay_budget_v2(chain_id,signer,day_utc)
);
CREATE INDEX arcade_freeplay_spending_scope_v2 ON arcade_freeplay_spending_v2(chain_id,signer,day_utc,run_id);
