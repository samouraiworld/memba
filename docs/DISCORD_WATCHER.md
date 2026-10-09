# Memba Discord watcher

The existing Discord channel receives both Memba realm activity and Launchpad
solvency alarms. Both use the Fly secret `LAUNCHPAD_WATCH_WEBHOOK_URL`. No extra
webhook or bot is needed. Ordinary activity never runs through solvency checks.

## Coverage

Production watches **all realm paths below `gno.land/r/samcrew/` on gnoland-1**,
including future realms: Connect 4, arcade leaderboard, governance/bridges, DAO
channels, feed, feedback, quests, reviews, App Store, badges, escrow and Launchpad.
One transaction can produce several named actions; long summaries are split.

The relay reports direct calls (even without custom events), package submission,
enable/rejection, and emitted events with matching realm paths, including storage
changes. Failed direct calls are marked FAILED with a fees-may-apply notice;
realm changes are reverted, but ante fees/sequence can persist. Rolled-back events are discarded.
Arguments, source, post bodies, event attributes, memos and error details are never
forwarded. Discord mentions are disabled. Each message has a chain, block and tx link.

Visits, local gameplay, frontend flags, off-chain multisig proposals and release
deployments are not chain events. Bank-only transfers without realm events are not
identified by namespace. Indirect calls through scripts/other realms need an emitted
event to identify the affected realm. Other users' DAOs need explicit paths. Onyx
and EVM are not watched by this mainnet process. A paused realm's notification does
not imply the feature is available in the frontend.

## Configuration

| Setting | Behavior |
|---|---|
| `MEMBA_ACTIVITY_WATCH_ENABLED` | Exactly `1` starts it; unset disables it. Enabled in `backend/fly.toml`. |
| `MEMBA_ACTIVITY_WATCH_REALMS` | Comma-separated exact paths or subtrees ending `/*`; default `gno.land/r/samcrew/*`. |
| `MEMBA_ACTIVITY_WATCH_RPC_URL` | One HTTPS node; default `https://rpc.mainnet.samourai.live`. |
| `GNO_CHAIN_ID` | Required; must match node identity and every block. |
| `LAUNCHPAD_WATCH_WEBHOOK_URL` | Existing `https://discord.com/api/webhooks/...` secret. Never print it. |

To add a DAO, preserve the namespace and append its exact path, e.g.
`gno.land/r/samcrew/*,gno.land/r/alice/dao`. Scope changes apply after restart and
watch future activity, without rescanning history. Run only one activity runner
against the database/channel (the production Fly app has one machine).

## Delivery and recovery

- First startup checkpoints the confirmed tip, five blocks behind head, and queues
  an enabled notice. No historical activity flood.
- Every 15 seconds scans at most 50 blocks, always five behind head. Cursor and
  notifications commit together in SQLite (`040_activity_watch.sql`).
- Drains pending messages before scanning further: at most 20 per cycle, paced by
  500 ms. Respects Discord `429 retry_after`; other failures retry next cycle.
  Scanning pauses behind delivery, bounding pending activity to one block.
- Uses `wait=true`; only HTTP 200 with a message ID acknowledges delivery. Removes
  acknowledged messages. Delivery is **at least once**: a timeout or crash between
  Discord acceptance and local acknowledgement can repeat a message. Its tx link
  identifies repeats.
- Restarts resume cursor/outbox without another enabled notice. Daily heartbeat
  only once caught up. No heartbeat while the RPC is stale, catching up, wrong-chain
  or behind the cursor.
- Checks saved/queued block hashes and block continuity. A changed confirmed block
  halts delivery for operator reconciliation; already-sent messages cannot be undone.
  Preserve the database and inspect the fork before deciding a rewind. Never reset
  the cursor merely to silence an error.
- Incompatible transactions/mismatched receipts halt instead of skipping activity.

## Monitoring and rollout

Retain the normal SQLite/Litestream recovery point before deployment. The additive
migration creates only activity state/outbox tables and an index. A rolling backend
deployment restarts the single machine and can interrupt the API for about 30 seconds.
Activation uses the existing secret and sends the enabled notice to the same channel.

Check `activity watcher started`, the enabled notice, then protected `/metrics`:
`memba_activity_watch_enabled=1`, advancing
`memba_activity_watch_progress_timestamp_seconds`, and
`memba_activity_watch_pending=0`. Progress advances on quiet blocks too. The existing
`memba_launchpad_*` series must remain healthy. Verify a normal realm call and its
transaction link; do not create a financial transaction just to test this service.

Stalled progress/delivery Prometheus rules still require an external scraper and
Alertmanager route; this feature does not install them. The backend cannot report
its own outage. A missing daily heartbeat is useful to a human, not an external alarm.

Disable `MEMBA_ACTIVITY_WATCH_ENABLED` to stop general activity while preserving
`LAUNCHPAD_WATCH_ENABLED=1` and the webhook secret for financial alarms. The cursor
is retained, so reenabling catches up activity since it stopped.

Tests cover restart/outage recovery, wrong/stale chain, changed block, failed calls,
rate limits, delivery receipts, realm boundaries, splitting/privacy, heartbeat and a
public mainnet Connect 4 enable fixture (height 658489).
