-- Marketplace — agent favorites and view tracking.

CREATE TABLE IF NOT EXISTS agent_favorites (
    address    TEXT NOT NULL,                    -- g1... user address
    agent_id   TEXT NOT NULL,                    -- agent ID from on-chain registry
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (address, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_favorites_address
    ON agent_favorites (address);

CREATE TABLE IF NOT EXISTS agent_views (
    agent_id   TEXT PRIMARY KEY,                 -- agent ID from on-chain registry
    view_count INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
