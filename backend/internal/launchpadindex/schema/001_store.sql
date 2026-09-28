-- Launchpad-only tables in the existing backed-up Memba SQLite database.
-- The scope key includes chain, realm and separately verified executable
-- publication identity. The cursor starts at the verified parent of the
-- activation block, so creations later in that block can be indexed.
-- Nothing here proves activation.

CREATE TABLE launchpad_scopes (
    scope_key            TEXT PRIMARY KEY,
    chain_id             TEXT NOT NULL,
    realm_path           TEXT NOT NULL,
    publication_height   INTEGER NOT NULL CHECK (publication_height > 1),
    publication_hash     BLOB NOT NULL CHECK (length(publication_hash) = 32),
    publication_parent_hash BLOB NOT NULL CHECK (length(publication_parent_hash) = 32),
    activation_tx_index  INTEGER NOT NULL CHECK (activation_tx_index >= 0),
    activation_mode      TEXT NOT NULL CHECK (activation_mode IN ('add_package', 'enable_package')),
    submission_tx_hash   BLOB NOT NULL CHECK (length(submission_tx_hash) = 32),
    activation_tx_hash   BLOB NOT NULL CHECK (length(activation_tx_hash) = 32),
    source_digest        BLOB NOT NULL CHECK (length(source_digest) = 32),
    publication_identity TEXT NOT NULL,
    cursor_height        INTEGER NOT NULL CHECK (cursor_height >= publication_height - 1),
    cursor_hash          BLOB NOT NULL CHECK (length(cursor_hash) = 32),
    CHECK ((activation_mode = 'add_package' AND submission_tx_hash = activation_tx_hash)
        OR (activation_mode = 'enable_package' AND submission_tx_hash <> activation_tx_hash)),
    UNIQUE (chain_id, realm_path, publication_height, publication_hash,
            activation_tx_hash, activation_tx_index)
);

CREATE TABLE launchpad_blocks (
    scope_key       TEXT NOT NULL REFERENCES launchpad_scopes(scope_key),
    height          INTEGER NOT NULL CHECK (height > 0),
    hash            BLOB NOT NULL CHECK (length(hash) = 32),
    parent_hash     BLOB NOT NULL CHECK (length(parent_hash) = 32),
    header_time     TEXT NOT NULL,
    PRIMARY KEY (scope_key, height)
);

CREATE TABLE launchpad_creation_events (
    scope_key       TEXT NOT NULL,
    height          INTEGER NOT NULL,
    tx_index        INTEGER NOT NULL CHECK (tx_index >= 0),
    event_index     INTEGER NOT NULL CHECK (event_index >= 0),
    token_id        TEXT NOT NULL,
    registry_key    TEXT NOT NULL,
    grc20_id        TEXT NOT NULL,
    creator         TEXT NOT NULL,
    mode            TEXT NOT NULL,
    ticker          TEXT NOT NULL,
    currency_key    TEXT NOT NULL,
    raw_attrs_json  TEXT NOT NULL,
    PRIMARY KEY (scope_key, height, tx_index, event_index),
    UNIQUE (scope_key, token_id),
    FOREIGN KEY (scope_key, height) REFERENCES launchpad_blocks(scope_key, height)
);

CREATE INDEX launchpad_creation_creator ON launchpad_creation_events(scope_key, creator, height);
