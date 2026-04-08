-- 010_gnobuilders.sql — GnoBuilders quest expansion
-- Extends the quest system from 10 to 85 quests with ranks, badges, and claims.
-- Existing quest_completions table is preserved (backward compatible).

-- User ranks (cached, recalculated on XP change)
CREATE TABLE IF NOT EXISTS user_ranks (
    address          TEXT PRIMARY KEY,
    rank_tier        INTEGER NOT NULL DEFAULT 0,
    rank_name        TEXT NOT NULL DEFAULT 'Newcomer',
    total_xp         INTEGER NOT NULL DEFAULT 0,
    quests_completed INTEGER NOT NULL DEFAULT 0,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Badge NFT minting log (for when chain is available)
CREATE TABLE IF NOT EXISTS badge_mints (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    address         TEXT NOT NULL,
    quest_id        TEXT NOT NULL,
    nft_token_id    TEXT,
    mint_status     TEXT NOT NULL DEFAULT 'pending' CHECK (mint_status IN ('pending', 'minted', 'failed')),
    metadata_cid    TEXT,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    minted_at       DATETIME,
    UNIQUE(address, quest_id)
);

-- Login streak tracking
CREATE TABLE IF NOT EXISTS login_streaks (
    address         TEXT PRIMARY KEY,
    current_streak  INTEGER NOT NULL DEFAULT 0,
    longest_streak  INTEGER NOT NULL DEFAULT 0,
    last_login_date DATE NOT NULL,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Self-report verification queue (admin review for self_report quests)
CREATE TABLE IF NOT EXISTS quest_claims (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    address         TEXT NOT NULL,
    quest_id        TEXT NOT NULL,
    proof_url       TEXT,
    proof_text      TEXT,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by     TEXT,
    reviewed_at     DATETIME,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(address, quest_id)
);

CREATE INDEX IF NOT EXISTS idx_user_ranks_tier ON user_ranks (rank_tier DESC);
CREATE INDEX IF NOT EXISTS idx_user_ranks_xp ON user_ranks (total_xp DESC);
CREATE INDEX IF NOT EXISTS idx_badge_mints_address ON badge_mints (address);
CREATE INDEX IF NOT EXISTS idx_quest_claims_status ON quest_claims (status);
CREATE INDEX IF NOT EXISTS idx_login_streaks_date ON login_streaks (last_login_date);
