-- 015_quest_proof.sql
-- Store the proof (the deployed realm/package path) per completion so deploy
-- quests can enforce a DISTINCT path per quest: one realm deploy can satisfy at
-- most one deploy quest, so a single hello-world can't farm all 19 (700 XP).
ALTER TABLE quest_completions ADD COLUMN proof TEXT;
