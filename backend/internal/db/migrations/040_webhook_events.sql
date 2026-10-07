-- 040_webhook_events.sql
-- Resend webhook deliveries already applied (svix-id), so a replay changes nothing.
CREATE TABLE IF NOT EXISTS webhook_events (
    id          TEXT PRIMARY KEY,
    received_at TEXT NOT NULL
);
