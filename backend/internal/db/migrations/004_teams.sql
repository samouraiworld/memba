-- Memba v2.28.0 — Teams for collaborative DAO management.

CREATE TABLE IF NOT EXISTS teams (
    id          TEXT PRIMARY KEY,               -- UUID
    name        TEXT NOT NULL,                   -- 1-64 chars
    invite_code TEXT NOT NULL UNIQUE,            -- 8-char alphanumeric
    created_by  TEXT NOT NULL,                   -- creator g1... address
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS team_members (
    team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    address    TEXT NOT NULL,                    -- g1... address
    role       TEXT NOT NULL DEFAULT 'member',   -- 'admin' or 'member'
    joined_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (team_id, address)
);

CREATE INDEX IF NOT EXISTS idx_team_members_address
    ON team_members (address);

CREATE INDEX IF NOT EXISTS idx_teams_invite_code
    ON teams (invite_code);
