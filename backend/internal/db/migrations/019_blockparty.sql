CREATE TABLE IF NOT EXISTS blockparty_challenges (
    date         TEXT PRIMARY KEY,          -- YYYY-MM-DD UTC
    block_height INTEGER NOT NULL,
    block_hash   TEXT NOT NULL,
    seed         INTEGER NOT NULL,          -- uint32 stored as INTEGER
    modifier     TEXT NOT NULL,
    par          INTEGER NOT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blockparty_scores (
    date                TEXT NOT NULL,
    address             TEXT NOT NULL,
    score               INTEGER NOT NULL,
    move_log            TEXT NOT NULL,       -- compact move string, e.g. "URDL..."
    board_hash_final    TEXT NOT NULL,
    verification_status TEXT,                -- nullable; reserved for bot detection
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (date, address)              -- one submission per address per day
);
CREATE INDEX IF NOT EXISTS idx_blockparty_scores_day ON blockparty_scores (date, score DESC);

CREATE TABLE IF NOT EXISTS blockparty_streaks (
    address           TEXT PRIMARY KEY,
    current           INTEGER NOT NULL DEFAULT 0,
    longest           INTEGER NOT NULL DEFAULT 0,
    last_played_date  TEXT,                  -- YYYY-MM-DD
    freezes_remaining INTEGER NOT NULL DEFAULT 1,
    week_anchor       TEXT,                  -- ISO week key for freeze refill
    updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
