-- Safes (EVM multisig) in each account's Multisig list, and the names owners
-- give them. Memba stores only this: the chain holds what a Safe is and who
-- owns it, the Safe Transaction Service its queue and history. A row is
-- written only after the server checked on chain that the account owns that
-- Safe. chain_id is CAIP-2 ("eip155:84532"); safe_address is lowercase 0x hex;
-- user_address is the account's canonical form (internal/address). The first
-- time a member names the Safe, name_set_at is set (a rename keeps it): an
-- owner without a name of their own is shown the first namer's current name.
-- Empty unless MEMBA_EVM_SAFE_CHAINS and Sign-In with Ethereum are on.
CREATE TABLE IF NOT EXISTS evm_safe_members (
    chain_id     TEXT     NOT NULL,
    safe_address TEXT     NOT NULL,
    user_address TEXT     NOT NULL,
    name         TEXT     NOT NULL DEFAULT '',
    name_set_at  TEXT,
    joined       BOOLEAN  NOT NULL DEFAULT TRUE,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chain_id, safe_address, user_address)
);

CREATE INDEX IF NOT EXISTS idx_evm_safe_members_user
    ON evm_safe_members (chain_id, user_address);
