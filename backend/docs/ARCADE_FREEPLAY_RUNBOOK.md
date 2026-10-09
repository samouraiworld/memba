# Free play database migration and recovery runbook

Status: reviewed-scope source preparation, not an execution authorization.
Repository path `backend/docs/ARCADE_FREEPLAY_RUNBOOK.md` reserved by Lead for A7. No live database,
replica, credential, signer or infrastructure was accessed while preparing this file.
No deployment or mainnet anchoring is authorized before the owner's return at23:00
Paris on9October2026; their return alone does not authorize an operation.

## Release and approval record

Record the following before scheduling a rollout. Empty fields block execution.

| Required evidence | Value to record |
| --- | --- |
| Owner's specific approval for automatic DB migration | Pending |
| Exact composed commit, image digest, prior rollback image | Pending A7 composition/review |
| Migration042 source | A2#1583,5fb77eed5fc1ac8b031b4f110c0363c65588b0e3 |
| Migration043 source | A6#1595,f1e963b09417c781f8cd577708096647d3c299ef |
| Runtime/publication configuration | Explicitly dormant; final configuration not approved |
| Actual app/machine/volume, DB path, replica identity | Verify scoped metadata at approved execution; do not infer from committed config |
| Recoverable snapshot/WAL generation and cutoff | Pending verified restoration |
| Restored copy SHA256, size, integrity/FK/schema evidence | Pending drill |
| Current-image and candidate-image behavior on separate clones | Pending approved isolated rehearsal |
| Measured recovery point/time and accepted data-loss interval | Pending; no assumed RPO/RTO |
| Operator, observer and maintenance/rollback window | Pending |

Source inspection is pinned to the commits above and the backend files in that
checkout. `backend/Dockerfile` pins Litestream0.3.13; `backend/litestream.yml` declares
24h snapshots and168h retention. These are repository settings, not proof that a
current production replica is healthy. `backend/fly.toml` documents a rolling,
volume-backed deployment; some configuration is overridden by secrets.

## What changes at startup

`backend/internal/db/db.go:Migrate` discovers embedded SQL filenames and records
full filenames in `_migrations`. It commits each SQL file and its registry entry in
one transaction, not the entire pending migration set in one transaction. Thus042
may be committed even if043 subsequently fails. An uncertain commit must be
inspected before another attempt; never manually mark an unapplied migration done.

042 adds `arcade_freeplay_runs_v2`, `arcade_freeplay_quotes_v2`,
`arcade_freeplay_outbox_v2` and `arcade_freeplay_signers_v2`. 043 adds
`arcade_freeplay_budget_v2`, `arcade_freeplay_spending_v2` and its scope index.
Existing tables are not altered. The candidate binary applies these migrations
**even when HTTP and publication are disabled**. Feature-off does not prevent DDL.
Inspect every pending migration in the final composed image, not just042/043;
other PRs can add migrations before that image is built.

Neither migration authorizes a signer or creates a funded budget. First reservation
records the approved daily limits; another process with different limits refuses.
Reservations are conservative allowances, not evidence of actual onchain spending.
They are not automatically refunded after cancellation, expiry or an unknown send.

## Preserve a recoverable pre-migration database

1. Review the real deployment topology and enumerate **all** writers to the database,
   including background jobs and any other process using the same signer. Arrange
   an owner-approved maintenance window. Stop admission, drain requests, cancel and
   await publisher/jobs, then stop the application gracefully. Confirm Litestream's
   final synchronization completed; preserve its checkpoint ownership. Do not issue
   competing WAL checkpoints or copy the live main DB file without its committed WAL.
2. Capture replica generation/snapshot/WAL metadata and the actual recovery cutoff.
   Snapshot age alone does not prove the latest WAL was shipped. If a final sync or
   recovery point cannot be demonstrated, stop before migration. Keep the existing
   DB volume and replica recoverable; do not overwrite or prune them.
3. Restore the replica to a **new, non-serving scratch path** in an isolated maintenance
   environment. Preserve this verified copy independently from the mutable candidate
   rehearsal and for longer than the migration/rollback window. Protect it as
   production data; record its SHA256 and recovery metadata, not secrets or replay
   contents. A seven-day retention setting is not a permanent rollback artifact.
4. Do not run `/app/start.sh` for the drill: it may restore into `/data`, import the
   legacy attester key and start replication/application jobs. Override the container
   entrypoint; provide only the separately authorized backup credentials. No keyring,
   signer secret or serving volume is mounted. Isolate network access during candidate
   startup so unrelated background jobs cannot affect real services.

The following commands are copied from the repository's established Litestream
workflow and are **templates for the approved maintenance environment only**.
They were not executed. Use a fresh scratch path; an existing destination is a stop
condition. The configured `/data/memba.db` below identifies the replica source;
it must not be a serving mount in the maintenance environment.

```sh
litestream generations -config /etc/litestream.yml /data/memba.db
litestream snapshots -config /etc/litestream.yml /data/memba.db
litestream restore -config /etc/litestream.yml -o /tmp/freeplay-pre-migration.db /data/memba.db
DB_PATH=/tmp/freeplay-pre-migration.db /app/memba integrity-check
```

These commands restore the available head. For a historical cutoff, verify the
installed pinned CLI's supported generation/time selectors before forming the
specific command; do not assume a flag or silently use a newer recovery point.
Record the selected generation and resulting cutoff. The integrity subcommand
returns before `db.Migrate` and opens with `mode=ro`, so it does not apply DDL.
The runtime image has no `sqlite3` CLI: do not install tools into a serving machine
as part of this procedure. Perform row/schema inspection on the isolated restored
copy in an approved analysis environment with SQLite tooling.

## Validate the copy and rehearse before rollout

Preserve one unchanged restored copy. Use separate clones for the old image and
candidate. Run the candidate only with publication dormant and isolated dependencies,
then stop it cleanly before inspecting its clone. There is no currently provided
migration-only application subcommand; a plain app start also initializes other
services. A future dedicated rehearsal harness needs scoped review, not an invented
command here.

Read-only SQL on the restored/rehearsal copy:

```sql
PRAGMA integrity_check;
PRAGMA foreign_key_check;
SELECT name FROM _migrations ORDER BY name;
SELECT name, sql FROM sqlite_master
 WHERE name LIKE 'arcade_freeplay_%_v2' ORDER BY name;
```

Expected: integrity exactly`ok`, no foreign-key violations, full migration filenames
match the candidate's embedded set, DDL matches reviewed source. Before first-ever
Free play rollout,042/043 may be absent in the pre-migration copy; do not mistake
that for damage or run table-specific queries before checking existence.
After migration, both registry entries and all six tables must exist. Failed043
with committed042 is a valid partial-set failure state requiring investigation.

If Free play data already exists, inspect aggregate state on the copy:

```sql
SELECT status, COUNT(*) FROM arcade_freeplay_runs_v2 GROUP BY status;
SELECT COUNT(*) AS unresolved_outbox FROM arcade_freeplay_outbox_v2
 WHERE tx_hash <> '';
SELECT COUNT(*) AS pending_signers FROM arcade_freeplay_signers_v2
 WHERE pending_run_id <> '';
SELECT COUNT(*) AS bad_reservation_scope
 FROM arcade_freeplay_spending_v2 s
 JOIN arcade_freeplay_runs_v2 r ON r.run_id=s.run_id
 JOIN arcade_freeplay_quotes_v2 q ON q.quote_id=s.quote_id
 WHERE s.chain_id<>r.chain_id OR q.run_id<>r.run_id
    OR q.payload_hash<>r.payload_hash;
SELECT b.chain_id,b.signer,b.day_utc
 FROM arcade_freeplay_budget_v2 b
 LEFT JOIN (
   SELECT chain_id,signer,day_utc,COUNT(*) AS attempts,
          SUM(fee_ugnot) AS fee,SUM(deposit_ugnot) AS deposit
   FROM arcade_freeplay_spending_v2 GROUP BY chain_id,signer,day_utc
 ) j ON j.chain_id=b.chain_id AND j.signer=b.signer AND j.day_utc=b.day_utc
 WHERE b.attempts<>COALESCE(j.attempts,0)
    OR b.fee_ugnot<>COALESCE(j.fee,0)
    OR b.deposit_ugnot<>COALESCE(j.deposit,0)
    OR b.attempts>b.max_attempts OR b.fee_ugnot>b.max_fee_ugnot
    OR b.deposit_ugnot>b.max_deposit_ugnot;
```

The first counts describe state; nonzero unresolved/pending counts are not license
to clear them. Scope and counter mismatch queries should return zero/no rows.
This inspection does not prove that a restore contains every latest reservation.
Compare exact relevant records against the protected pre-change baseline as well;
do not log tokens, secrets or full replay payloads. Record old-image behavior on
its clone containing the new additive schema; additive DDL alone is not a claim
that a composed rollback image has been tested.

## Approved dormant rollout and observation

Only after backup/rehearsal evidence and the specific migration go: deploy the exact
approved image through the central Lead's release process. No flag, attester,
allowlist, funding or signer configuration changes belong to this DB step.
Observe migration logs, health, normal legacy API behavior and continued404/dormancy
of Free play. Check restored-copy invariants against a separately captured post-change
copy. Ensure replication resumes and protects the post-migration schema/data. A
health200 alone is insufficient migration or publication evidence.

Abort promotion for migration errors, missing registry/table pairs, integrity/FK
failures, unexpected Free play activation, a backup gap or failed legacy smoke
checks. Preserve the failed image/logs and DB/WAL state for diagnosis.

## Prefer binary rollback while preserving the database

For an application regression with a healthy DB, keep publication off, drain all
writers, and return to the approved prior image using the central release process.
Retain042/043 and all records. Do not drop tables, delete `_migrations` entries,
reset budgets or replay migration files manually. Verify the prior image against
the same schema in rehearsal before relying on this path. Keep rollback and
migration evidence together.

## Database restoration is a separate recovery operation

Restore only for a demonstrated database problem after assessing the data-loss
interval across **all** Memba features. Never replace a DB underneath a running
application or Litestream process. Stop and await every writer/replicator, preserve
the incident database **and its matching WAL/SHM set** in quarantine, validate the
replacement on an isolated/new volume, and perform the approved offline cutover.
Do not attach old WAL/SHM files to a restored main database. Retain quarantine for
forensics rather than deleting sidecars as an unreviewed cleanup step. The exact
volume/machine cutover command depends on the confirmed topology and is not supplied
with guessed identifiers. Prevent a missing file from triggering `start.sh`'s
first-boot empty-database path; an unavailable backup is a stop condition.

**If any broadcast may have occurred after the recovery cutoff, publication and
all writers for that signer stay disabled.** A stale restore can lose a consumed
quote, a reservation or the durable`unknown`marker. Starting the publisher could
then rebroadcast or reuse already consumed allowance. Expired leases, an empty
restored outbox, UTC midnight or a missing receipt on one RPC do not prove safety.
Reconcile the latest surviving ledger/outbox and committed chain records using
validated target/attester/entry evidence. Missing records may mean the full set of
potentially sent run IDs is unknown; a few successful lookups do not close that
gap. Escalate the incomplete accounting to the owner and keep the signer stopped.
Do not refund, reset or rotate a signer to bypass this condition. Resuming requires
a separately reviewed reconstruction/accounting decision and explicit approval.

Before first activation, a pre-migration restore still rolls back unrelated users'
new data. It needs an explicit accepted recovery point even if no Free play spend
was ever possible. The old general clean-start advice in OPS_RUNBOOK is not a
Free play recovery authorization.

## Evidence delivered versus remaining

Delivered locally: A6#1595 targeted55PASS under-race in one run, including temporary
SQLite migrations, independent-writer contention, UTC/expiry, restart, atomic
journal/counters and safe integer limits. Source SHA256 values are in
A6-REVIEW-PACKET/source-manifest.sha256; logs in A3-A6-VALIDATION. No production
restore drill, image rollback rehearsal, replica health check or live migration
has been performed. Those pending proofs remain explicit pre-rollout gates.

References: backend/internal/db/db.go, backend/internal/db/integrity.go,
backend/cmd/memba/main.go, backend/start.sh, backend/litestream.yml,
backend/Dockerfile, docs/OPS_RUNBOOK.md§4.7 and A7-BACKEND-COMPOSITION-INVENTORY.md.

## Runtime shutdown scope

The shared admission tracker covers registered HTTP handlers, including non-Arcade
handlers after forced connection closure, and this runtime's publisher and limiter.
It does not prove that independent goroutines owned by other subsystems have
stopped. Their writers and the replicator still require the quiescence procedure
above. A tracker drain failure prevents bundle cleanup and the exit checkpoint;
Litestream retains its existing checkpoint policy.
