-- Memba v2.27.0 — Quest completions for DAO onboarding XP tracking.

CREATE TABLE IF NOT EXISTS quest_completions (
    address      TEXT NOT NULL,
    quest_id     TEXT NOT NULL,
    completed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (address, quest_id)
);

CREATE INDEX IF NOT EXISTS idx_quest_completions_address
    ON quest_completions (address);
