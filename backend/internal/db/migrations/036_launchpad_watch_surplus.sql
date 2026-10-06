-- 036_launchpad_watch_surplus.sql
-- The Launchpad watcher's state per chain, realm and currency: the baseline
-- surplus (balance minus owed), which only ever rises, so a reading below it
-- pages; the last stable reading's height, so a node that has not passed it
-- (stuck, or behind after a restart) is not read as news; and, while a fall
-- is not yet paged, the lowest surplus it reached. Decimal text: amounts may
-- exceed 2^63.
CREATE TABLE IF NOT EXISTS launchpad_watch_surplus (
    chain_id   TEXT NOT NULL,
    realm      TEXT NOT NULL,
    currency   TEXT NOT NULL,
    surplus    TEXT NOT NULL,
    height     INTEGER NOT NULL,
    fell_to    TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (chain_id, realm, currency)
);
