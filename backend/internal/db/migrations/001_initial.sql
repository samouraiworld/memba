-- Memba v0.1.0 — Initial Schema
-- Multisig wallets, members, transactions, and signatures.

-- Multisig wallets
CREATE TABLE IF NOT EXISTS multisigs (
    chain_id      TEXT NOT NULL,
    address       TEXT NOT NULL,
    pubkey_json   TEXT NOT NULL,
    threshold     INTEGER NOT NULL CHECK (threshold > 0),
    members_count INTEGER NOT NULL CHECK (members_count > 0),
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chain_id, address)
);

-- Member ↔ Multisig relationship
CREATE TABLE IF NOT EXISTS user_multisigs (
    chain_id         TEXT NOT NULL,
    user_address     TEXT NOT NULL,
    multisig_address TEXT NOT NULL,
    name             TEXT NOT NULL DEFAULT '',
    role             TEXT NOT NULL DEFAULT 'dev' CHECK (role IN ('admin', 'dev')),
    joined           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chain_id, user_address, multisig_address)
);

CREATE INDEX IF NOT EXISTS idx_user_multisigs_multisig
    ON user_multisigs (chain_id, multisig_address);

-- Proposed transactions
CREATE TABLE IF NOT EXISTS transactions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id         TEXT NOT NULL,
    multisig_address TEXT NOT NULL,
    msgs_json        TEXT NOT NULL,
    fee_json         TEXT NOT NULL,
    account_number   INTEGER NOT NULL,
    sequence         INTEGER NOT NULL,
    memo             TEXT NOT NULL DEFAULT '',
    creator_address  TEXT NOT NULL,
    final_hash       TEXT UNIQUE,
    type             TEXT NOT NULL DEFAULT 'send',
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transactions_multisig
    ON transactions (chain_id, multisig_address);

CREATE INDEX IF NOT EXISTS idx_transactions_creator
    ON transactions (creator_address);

-- Individual signatures per transaction
CREATE TABLE IF NOT EXISTS signatures (
    transaction_id INTEGER NOT NULL,
    user_address   TEXT NOT NULL,
    signature      TEXT NOT NULL,
    body_bytes     BLOB,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (transaction_id, user_address),
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
);
