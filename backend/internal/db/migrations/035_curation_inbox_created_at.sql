-- 035_curation_inbox_created_at.sql
-- Curation inbox messages are kept 12 months. The retention sweep deletes the
-- older ones in small batches; this index finds each batch without scanning the
-- table, so one batch holds the write lock only for the rows it removes.
CREATE INDEX IF NOT EXISTS idx_curation_inbox_created_at
    ON curation_inbox_messages (created_at);
