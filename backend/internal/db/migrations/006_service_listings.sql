-- Service listings — freelancers advertise their skills and offerings.

CREATE TABLE IF NOT EXISTS service_listings (
    id          TEXT PRIMARY KEY,               -- UUID
    address     TEXT NOT NULL,                   -- freelancer g1... address
    title       TEXT NOT NULL,                   -- 1-200 chars
    description TEXT NOT NULL DEFAULT '',        -- up to 2000 chars
    category    TEXT NOT NULL DEFAULT 'other',   -- development, design, writing, consulting, marketing, other
    price       INTEGER NOT NULL,               -- suggested price in ugnot
    delivery_days INTEGER NOT NULL DEFAULT 7,   -- estimated delivery in days
    tags        TEXT NOT NULL DEFAULT '',        -- comma-separated tags
    active      INTEGER NOT NULL DEFAULT 1,     -- 1=active, 0=paused
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_service_listings_address
    ON service_listings (address);

CREATE INDEX IF NOT EXISTS idx_service_listings_category
    ON service_listings (category);

CREATE INDEX IF NOT EXISTS idx_service_listings_active
    ON service_listings (active);
