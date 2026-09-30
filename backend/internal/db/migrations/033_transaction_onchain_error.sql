-- Why the chain refused a native multisig transaction. With final_hash
-- (verified FALSE) it was refused while running and used the account's
-- sequence: the proposal is closed. Without, it was refused before execution
-- and the signed transaction can still be broadcast.
ALTER TABLE transactions ADD COLUMN onchain_error TEXT;
