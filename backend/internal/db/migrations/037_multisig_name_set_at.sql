-- 037_multisig_name_set_at.sql
-- When a member first named a multisig (a rename keeps it). Another member
-- whose own name is empty is shown the current name of the first namer (read
-- time, nothing is copied), ordered by this time. Rows named before this column existed keep
-- NULL and order by their creation time, ahead of any name given later.
ALTER TABLE user_multisigs ADD COLUMN name_set_at TEXT;
