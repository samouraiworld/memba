-- Verified BARRICADE run submissions. Each row is a run whose input log the
-- verify worker (internal/arcade) RE-SIMULATED and whose result the player's
-- client claimed correctly — never a client-claimed number stored blind. The
-- events (the input log) are kept for day-close publication + re-verification;
-- input_log_sha256 is the commitment the attester writes on-chain and the
-- backend's own replay-theft guard (a log binds to the first address to submit
-- it, mirroring the realm's global hashOwners net).
CREATE TABLE IF NOT EXISTS arcade_runs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    input_log_sha256  TEXT    NOT NULL UNIQUE,
    addr              TEXT    NOT NULL,
    day               TEXT    NOT NULL,               -- YYYY-MM-DD (daily seed's date; practice = submission day)
    mode              TEXT    NOT NULL,               -- 'daily' | 'practice'
    seed              TEXT    NOT NULL,
    sim_version       INTEGER NOT NULL,
    score             INTEGER NOT NULL,
    waves             INTEGER NOT NULL,
    won               INTEGER NOT NULL DEFAULT 0,     -- 0/1
    overtime_round    INTEGER NOT NULL DEFAULT 0,
    state_hash        TEXT    NOT NULL,
    events            TEXT    NOT NULL,               -- the input log (compact JSON) for re-verify + publication
    status            TEXT    NOT NULL DEFAULT 'verified',  -- 'verified' | 'attested'
    attested_txhash   TEXT,
    created_at        INTEGER NOT NULL,               -- unix seconds
    attested_at       INTEGER
);

-- Day-close batcher ranks a day's competitive board (daily mode, highest score
-- per address first) and finds which verified rows still need attesting.
CREATE INDEX IF NOT EXISTS idx_arcade_runs_board ON arcade_runs(day, mode, score DESC);
CREATE INDEX IF NOT EXISTS idx_arcade_runs_status ON arcade_runs(day, status);
CREATE INDEX IF NOT EXISTS idx_arcade_runs_addr ON arcade_runs(addr, day);
