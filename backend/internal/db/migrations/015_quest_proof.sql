-- 015_quest_proof.sql
-- Store the proof (the canonical deployed realm/package path) per completion so
-- deploy quests can enforce a DISTINCT path per quest: one realm deploy satisfies
-- at most one deploy quest, so a single hello-world can't farm all 18 (~600 XP).
ALTER TABLE quest_completions ADD COLUMN proof TEXT;

-- Belt-and-suspenders against the check-then-insert race (the COUNT(*) dedup in
-- verifyDeployQuest is non-transactional, and MaxOpenConns(1) serializes
-- statements but not the read-then-write across two calls): a given proof backs
-- at most one deploy quest per address, enforced at the DB level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_quest_proof_unique
  ON quest_completions (address, proof)
  WHERE quest_id LIKE 'deploy-%' AND proof IS NOT NULL AND proof != '';
