-- Multi-game arcade: scope arcade_runs by game slug (BARRICADE, Space
-- Invaders, future titles — one table, boards keyed per game, mirroring the
-- amended memba_arcade_leaderboard_v1 realm). Additive only: existing rows
-- backfill to 'barricade' (the only game that ever wrote here).
--
-- waves/won/overtime_round are barricade-legacy DISPLAY columns (Space
-- Invaders writes its wave-reached into waves and 0 for the rest); `stats` is
-- the canonical per-game realm payload — the compact attester-authored JSON
-- blob AttestScore/AttestReceipt now carry instead of per-game positional args.
ALTER TABLE arcade_runs ADD COLUMN game TEXT NOT NULL DEFAULT 'barricade';
ALTER TABLE arcade_runs ADD COLUMN stats TEXT NOT NULL DEFAULT '';

-- Game-scoped twins of the day-close batcher's indexes: rank one game's board
-- and find its pending days without scanning the other games' rows.
CREATE INDEX IF NOT EXISTS idx_arcade_runs_game_board ON arcade_runs(game, day, mode, score DESC);
CREATE INDEX IF NOT EXISTS idx_arcade_runs_game_status ON arcade_runs(game, day, status);
