# Memba Operational Runbook

> **Scope**: day-to-day operational procedures, recurring tasks, and incident playbooks for `memba.samourai.app` (frontend) and `memba-backend.fly.dev` (backend).
> **Owner**: zxxma (currently sole code owner — see v7.1 plan §1.8 for the planned reviewer-recruitment follow-up).
> **Audit trail**: see `docs/planning/MEMBA_V7_1_IMPLEMENTATION_PLAN.md` (live plan) and `docs/planning/archive/v7.1-phase0/` (Phase 0 expert reviews + PR triage) for the rationale behind the procedures below.

---

## 1. Recurring tasks

| Cadence | Task | Reference |
|---------|------|-----------|
| Weekly | Dependabot triage — review the grouped PRs (see `.github/dependabot.yml`), merge patch/minor groups, file v7.2 spike issues for any majors. | `docs/DEPENDENCY_POLICY.md` (Phase 0b deliverable) |
| Weekly | Read the latest `govulncheck.yml` cron output. If any new CVE landed, file an issue and PR a bump within the SLA (HIGH = 5 BD, CRITICAL = 48h). | Phase 0a |
| Monthly | Sentry release health review — verify source maps present for the last 4 releases; confirm error rate is within SLO (§3.2). | Phase 0a |
| Quarterly | Domain renewal check: `samourai.app` and `samourai.live` — autopay on, expiry ≥ 30 days out. | v7.1 plan §19 Q18 |
| Quarterly | Secret rotation drill — see `docs/SECRETS_ROTATION.md` for the per-secret playbook. Includes `FLY_API_TOKEN`, `NETLIFY_AUTH_TOKEN`, `SENTRY_AUTH_TOKEN`, `SLACK_WEBHOOK_URL`, `ED25519_SEED`, Clerk pair, GPG signing keys, admin multisig keys. | Phase 1.12 |
| Annual | Emergency multisig custody rotation (channels v3 two-tier pause guard) — see `docs/MAINNET_PREPARATION.md` §Custody. | Phase 1.11 |
| Annual | Rollback drill — see §4 below; record results in `docs/reports/v7.1-rollback-drill-YYYY.md`. | Phase 5 prereq |

---

## 2. Service overview

| Surface | URL | Tech | Deploy target |
|---------|-----|------|---------------|
| Frontend | `memba.samourai.app` | React + Vite SPA | Netlify (`memba-multisig` site) |
| Backend | `memba-backend.fly.dev` | Go + ConnectRPC | Fly.io (app `memba-backend`, region `cdg`, 1 shared-cpu-1x machine, `min_machines_running=1`, volume `memba_data` mounted at `/data`) |
| Chain | `test-13` (live); `gnoland1` after Phase 5 | Gno | Official RPC: `rpc.test13.testnets.gno.land`; betanet: `rpc.gnoland1.samourai.live` |

### Critical environment variables

| Var | Surface | Owner | Notes |
|-----|---------|-------|-------|
| `ED25519_SEED` | Fly | server-keypair | If empty, ephemeral keypair → every restart logs out all users. See `backend/internal/service/service.go`. |
| `GNO_CHAIN_ID` | Fly | auth | Required for AUTH-CHAINID-01 enforcement; set to `test-13` in prod. No hardcoded default — `service.go` reads it from env and logs a warning if empty. |
| `FLY_API_TOKEN` | GitHub Actions | deploys + GHCR mirror | |
| `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID` | GitHub Actions | Netlify deploy | |
| `SENTRY_AUTH_TOKEN` | GitHub Actions | source-map upload | Required by `@sentry/vite-plugin`; was unwired before `v6.0.2`. |
| `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Netlify + backend | Clerk auth (alerts) | Must be the *same* environment (test/live). |
| `OPENROUTER_API_KEY` | Fly | AI analyst | Rate-limited; not on the critical path. |
| `LIGHTHOUSE_API_KEY` | Fly | IPFS gateway | |
| `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY` | Fly (backend) | multisig — A3 enforcement | Server-side member-signature verification at `SignTransaction` (`backend/internal/auth/multisig_verify.go`). **Unset / `0` / `false` = log-only** (failures accepted, recorded on `memba_multisig_sig_verify_total{result="mismatch"}`); `1` / `true` = **enforce** (reject failures). Flip ONLY per the §2.1 procedure — flipping with a live reconstruction mismatch bricks all multisig signing. |
| `MEMBA_ALLOW_UNSIGNED_AUTH` | Fly (backend) | auth — A2 enforcement | Empty-signature login policy (`backend/internal/auth/crypto.go allowUnsignedAuth()`). **Unset / `0` / `false` = enforce** (reject empty sigs — the fail-closed default since the 2026-06-28 Wave-1 hardening); `1` / `true` = **accept-but-log** (dev / Phase-1 opt-in only, impersonation-capable). Live prod is **unset → enforcing** (verified 2026-07-02: not in `fly.toml [env]`, not a Fly secret). Lockout rollback: §2.1. |
| `VITE_ENABLE_TREASURY_SPEND` | Netlify (frontend) | funds — A1.a kill-switch | `false` (default) hides Propose-Spend, blocks `/treasury/propose`, and shows a fund-safety banner. Keep `false` until the on-chain banker (A1.c) lands. CI (`ci.yml` safety gate) blocks `true`. Flip procedure: §2.1. |
| `VITE_ENABLE_NFT`, `VITE_ENABLE_AGENT_CREDITS` | Netlify (frontend) | funds — A9 / A5.ui kill-switches | `false` (default). NFT custody + agent-credit deposits are fund-trapping until their realms are completed/redeployed. Same CI safety gate blocks `true`. |

> The three `VITE_ENABLE_*` flags above are **fund-safety kill-switches**: the CI safety gate in `.github/workflows/ci.yml` fails the build if any is set to `true` in `.env.example`. Flipping one ON is a deliberate, reviewed decision tied to a completed on-chain feature.

### 2.1 Security-flag flip procedures

**`MEMBA_ALLOW_UNSIGNED_AUTH` (A2 empty-signature policy).** Enforcement is already live: the code fail-closes when the var is unset (Wave-1 hardening, 2026-06-28) and prod does not set it. There is no "flip to enforce" step anymore — only an emergency re-open:
1. **Lockout rollback (emergency only):** if legitimate users cannot log in because of the empty-signature rejection, `flyctl secrets set MEMBA_ALLOW_UNSIGNED_AUTH=1 -a memba-backend` (rolling restart) to temporarily accept-but-log. ⚠️ `flyctl secrets unset` does **not** re-open — unset means enforce.
2. While re-opened, the backend logs a loud impersonation-capable warning at startup and per-login `auth_login result=empty_allowed` lines; watch the signed-login ratio and remove the secret (`flyctl secrets unset MEMBA_ALLOW_UNSIGNED_AUTH -a memba-backend`) to restore enforcement as soon as the frontend issue is fixed.
3. Verify after any change: a fresh login with a real signature succeeds; `auth_login` shows `empty_rejected` climbing only for stale/abusive clients (enforcing) or `empty_allowed` (re-opened).

**`MEMBA_ENFORCE_MULTISIG_SIG_VERIFY` → `1` (A3 enforce flip).** The verifier reconstructs each member's sign-bytes from the stored tx columns and rejects signatures that don't verify. Enforcing while the reconstruction diverges from what Adena actually signs would reject EVERY member signature (multisig bricked), so the flip is gated on two readouts that both come from **real signatures**:

1. **Deploy first, read the sweep.** Every boot runs a read-only retro-sweep (`SweepMultisigSigVerify`) that re-verifies ALL stored signatures and publishes `memba_multisig_sig_verify_sweep{result}` (gauge) plus a `multisig_sig_verify_sweep: done` log line with `ok/mismatch/legacy_shape/error` totals. (The sweep joins `signatures → transactions → multisigs`; nothing hard-deletes those rows today, but if that ever changes, orphaned signature rows would drop out of the totals silently.) `legacy_shape` rows predate the canonical stored shape (pre-W2.4) and are expected to be non-zero on prod; they do NOT block the flip. **`mismatch` must be 0** — any mismatch row is logged individually with `tx_id`, `signer`, and `signed_at`; investigate before proceeding (a recent `signed_at` means the live reconstruction still diverges).
2. **Watch the live counter.** `memba_multisig_sig_verify_total{result}` increments on every `SignTransaction`. Leave log-only mode running until real member signatures show `ok` climbing and `mismatch` staying flat (a handful of organic signs is enough — every one is a real Adena signature verifying against the reconstruction).
3. **Flip:** `flyctl secrets set MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1 -a memba-backend` (rolling restart). Verify: a fresh member sign succeeds; `multisig_sig_verify result=ok` continues; any `result=rejected` line is now an actual rejection — treat a burst of rejections as the rollback trigger.
4. **Rollback (multisig lockout):** `flyctl secrets unset MEMBA_ENFORCE_MULTISIG_SIG_VERIFY -a memba-backend` — unset **is** log-only (fail-open by design here, the opposite polarity of `MEMBA_ALLOW_UNSIGNED_AUTH`); signing recovers immediately while mismatches keep being logged for diagnosis.

The byte-parity evidence backing this flip lives in `backend/internal/auth/testdata/signbytes/` (real gnokey signatures over the frontend's exact stored shapes, incl. the `frontend_*_parity` vectors on chain id `test-13`) and `frontend/src/lib/multisigTx.golden.test.ts` (frontend builders pinned to those same vectors). Residual risk — Adena's own serializer differing from gnokey's — is exactly what the sweep + live counter measure on real rows.

**`VITE_ENABLE_TREASURY_SPEND` → `true`.** Do **not** flip until A1.c implements the on-chain banker treasury — until then a passing spend proposal cannot execute and funds sent to the DAO are irrecoverable. When ready: remove the flag from the `ci.yml` safety-gate list in the same PR, set it in Netlify, redeploy.

---

## 3. Deploy and observability

### 3.1 Deploy pipeline

* **Backend**: push to `main` triggers `.github/workflows/deploy-backend.yml` (path-filtered on `backend/**`). The workflow gates on `ci-backend` (build + race-test + govulncheck), then `flyctl deploy --remote-only` with `[deploy] strategy = "rolling"` (per `fly.toml`). After deploy, the Fly image is mirrored to `ghcr.io/samouraiworld/memba-backend:<git-describe>` as a rollback insurance copy (see §4.1).
* **Frontend**: push to `main` triggers `.github/workflows/deploy-frontend.yml` (path-filtered on `frontend/**`). The workflow gates on `ci-frontend` (typecheck + lint + test + build + `npm audit --omit=dev` — **no `|| true`**), then `nwtgck/actions-netlify@v3` does a production deploy. `SENTRY_AUTH_TOKEN` is passed in env so the Vite plugin can upload source maps; an explicit guard step asserts that `dist/assets/*.js.map` files were produced.
* **Concurrency**: both deploy workflows use `cancel-in-progress: false` — rapid second pushes **queue** rather than canceling an in-flight deploy mid-traffic-flip.

### 3.2 SLO (operational definition of "broken")

| Signal | Target | Source |
|--------|--------|--------|
| Sentry error rate, rolling 5 min | < 1 % | Sentry |
| `/health` HTTP 200 | > 99.5 % over 24 h | Fly health check (30 s interval) |
| Login flow (connect wallet → main app) | > 99 % | Sentry breadcrumbs (Phase 4 instrumentation) |
| Deploy MTTR (detection → rollback complete) | < 10 min | §4 below |

A breach pages zxxma (Slack webhook), triggers a change freeze, and requires a post-mortem in `docs/reports/`.

### 3.3 Observability

* **Sentry release tags**: `memba@<version>` for both backend and frontend. Source maps are uploaded on every Netlify deploy; verify in the Sentry "Releases" tab.
* **govulncheck cron**: `govulncheck.yml` runs every Monday 08:00 UTC. Pin: `golang.org/x/vuln/cmd/govulncheck@v1.3.0`. Failure → manual triage (no auto-issue today; planned for Phase 4).
* **Fly metrics**: `flyctl metrics` for memory / cpu / requests; volume usage via `flyctl volumes status memba_data`.

### 3.4 Prometheus `/metrics` — signals & alert thresholds

The backend exposes Prometheus metrics at `GET /metrics`, **bearer-gated** by
`METRICS_BEARER` (a scrape must send `Authorization: Bearer <token>`; the token is
the raw secret value with no `Bearer ` prefix). When unset the endpoint fails
closed in prod (503 on Fly) and serves unauthenticated only off-Fly (dev) — keep
`METRICS_BEARER` set in prod (U-2). Quick check:

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://memba-backend.fly.dev/metrics                       # 401 (gated)
curl -s -H "Authorization: Bearer $METRICS_BEARER" https://memba-backend.fly.dev/metrics | grep memba_
```

All metrics are prefixed `memba_`. Thresholds below are starting points — tune to
observed baselines and route to Slack `#memba-alerts`. `rate()`/`increase()` use a
5-minute window unless noted.

**RPC & saturation** (W6.5 PR2)

| Signal | Alert when | Means / action |
|--------|-----------|----------------|
| `histogram_quantile(0.99, sum by (le,procedure) (rate(memba_rpc_duration_seconds_bucket[5m])))` | p99 > 1s for a procedure, 5 min | A specific RPC is slow — check its handler + DB contention below. |
| `sum by (code) (rate(memba_rpc_duration_seconds_count{code!="ok"}[5m])) / sum(rate(memba_rpc_duration_seconds_count[5m]))` | error ratio > 5%, 5 min | RPC error surge; break down by `code` (`internal`/`unauthenticated`/`panic`). Any `code="panic"` > 0 pages immediately (a handler is panicking — check Sentry/logs). |
| `memba_rpc_in_flight` | > 20 sustained 2 min (tune to traffic) | Requests are piling up — usually the single-writer DB lock (see below). A histogram only records *after* completion, so this is the leading indicator of a wedge. |

**DB connection pool** (W6.5 PR2) — SQLite runs `MaxOpenConns(1)`, so the pool is the single-writer bottleneck.

| Signal | Alert when | Means / action |
|--------|-----------|----------------|
| `rate(memba_db_wait_duration_seconds_total[5m])` | > 0.5 sustained 5 min | Fraction of wall-clock time RPCs spend blocked on the DB lock (1.0 = fully saturated). The **primary** DB-saturation signal. Check for a long-running write / migration / indexer contention. |
| `rate(memba_db_wait_count_total[5m])` | climbing with the above | Number of goroutines queuing for a connection — corroborates saturation. |
| `memba_db_connections_in_use` | pinned at 1 while `wait` climbs | The single writer is held; pair with `memba_rpc_in_flight`. |

> These two are **counters** (`_total`); always wrap in `rate()`/`increase()`. They reset to 0 on each Fly redeploy — `rate()` is counter-reset-aware, a raw gauge read is not.

**Indexer** (Wave 1)

| Signal | Alert when | Means / action |
|--------|-----------|----------------|
| `memba_indexer_lag_blocks` | > 30 for 2 min | NFT tailer falling behind the tip — check RPC health / tailer logs. |
| `increase(memba_indexer_last_block[10m])` | == 0 while `memba_indexer_chain_head` rises | Tailer **frozen** (the ~150k-block silent stall class). Restart / investigate. |
| `increase(memba_nft_event_dropped_total[1h])` | > 0 | On-chain event-schema drift — a Sale/mint was skipped as malformed; inspect the dropped `event` label + logs. |

**Auth & abuse** (Wave 0/1)

| Signal | Alert when | Means / action |
|--------|-----------|----------------|
| `rate(memba_auth_login_total{result="signed"}[1h]) / rate(memba_auth_login_total[1h])` | signed-login ratio — watch (not page) | The gate signal before flipping `MEMBA_ALLOW_UNSIGNED_AUTH` / A3 enforce (§2.1). Flip only when ≈ 100%. Exact match — `=~"signed"` would also count `signed_invalid` / `signed_invalid_rejected` and inflate the ratio. |
| `memba_multisig_sig_verify_sweep{result="mismatch"}` | > 0 on recent rows | Blocks the `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY` flip (U-3). `legacy_shape` is expected for old rows; `mismatch` on recent rows is the blocker. |
| `rate(memba_quest_rate_limit_exceeded_total[15m])` | spike vs baseline | Quest farming/sybil pressure — a wallet or cohort hitting quota in lockstep. |

---

## 4. Rollback playbooks

### 4.1 Backend rollback

Memba runs **rolling** deploys (`fly.toml` `[deploy] strategy = "rolling"`) because the single shared-cpu-1x machine has a persistent volume — bluegreen is unsupported under those constraints. Expect ≤ 30 s of restart downtime per deploy.

**Canonical path** — Fly's own release ledger:

```bash
flyctl releases list -a memba-backend          # find the last-good release ID
flyctl releases rollback <id> -a memba-backend # instant; pulls the prior image from Fly registry
```

**Fallback** — when Fly garbage-collects an old image (retention is undocumented and assumed shallow), use the GHCR mirror written on every successful deploy:

```bash
# List mirrored tags
docker pull ghcr.io/samouraiworld/memba-backend:<vX.Y.Z>
# Deploy the explicit image:
flyctl deploy --image ghcr.io/samouraiworld/memba-backend:<vX.Y.Z> -a memba-backend
```

**MTTR target**: < 5 min from incident detection to traffic restoration.

### 4.2 Frontend rollback

Netlify retains every deploy. Two options:

* Netlify UI → site → Deploys → previous deploy → **Publish deploy**.
* CLI: `netlify api restoreSiteDeploy --data='{"site_id":"<id>","deploy_id":"<id>"}'`.

**MTTR target**: < 2 min.

### 4.3 Volume snapshot restore

SQLite at `/data/memba.db`. Snapshots are retained per `fly volumes update memba_data --snapshot-retention 5` (one-time setup; verify with `fly volumes snapshots list memba_data`).

Restore procedure:

```bash
fly volumes snapshots list memba_data
# Pick a snapshot ID, create a new volume from it:
fly volumes create memba_data_restored --snapshot-id <id> --region cdg --size 1
# Stop machine, swap mount, start
fly machine stop <machine-id> -a memba-backend
fly machine update <machine-id> --mount memba_data_restored:/data -a memba-backend
fly machine start <machine-id> -a memba-backend
```

**MTTR target**: < 10 min.

### 4.4 Database corruption (no recent snapshot)

Memba's SQLite is not the source of truth for user-visible state — DAOs, multisigs, tokens all live on-chain. The backend DB stores: profile preferences, multisig coordination metadata, quest progress, analyst cache, oauth scratch state. Worst-case loss is degraded UX, not lost user funds.

**Automatic first line of defense (start.sh):** every boot runs `memba integrity-check` (`PRAGMA integrity_check`) against `/data/memba.db` before Litestream starts. A corrupt file is quarantined as `/data/memba.db.corrupt-<ts>` (plus its `-wal`/`-shm`) and the DB is restored from the Litestream S3 replica automatically. If that restore FAILS the machine exits loudly on purpose — a fresh empty DB would present as total data loss. Recovery order in that case: (1) manual Litestream restore per §4.7, (2) volume snapshot per §4.3, (3) clean start below. The quarantined file stays on the volume for forensics — delete it once resolved.

> **W2.3 note:** the old same-volume `VACUUM INTO` backups (`/data/backups/`, daily) are RETIRED — they couldn't survive the failure mode that actually happened (volume loss) and raced Litestream for I/O. Any `/data/backups/` files still on the volume are pre-retirement leftovers; the S3 replica is the single backup mechanism. Machines deployed before the retirement may still carry them — usable in a pinch, but never fresher than their file date.

If a snapshot restore isn't possible, drop the bad DB and the app starts clean on next deploy:

```bash
fly ssh console -a memba-backend
# Inside the machine:
rm /data/memba.db /data/memba.db-wal /data/memba.db-shm
exit
fly machine restart <machine-id> -a memba-backend
```

Users will be logged out (their auth tokens are in localStorage, but the server's nonce-tracker is also wiped — replay protection re-initialises cleanly).

### 4.5 Full v7.1 rollback (worst case)

1. `git revert` the release commit; re-tag the previous good as `v7.1.0-rollback`.
2. Fly rollback via §4.1 GHCR mirror.
3. Netlify rollback via §4.2 previous deploy.
4. File post-mortem at `docs/reports/v7.1-postmortem.md`.

### 4.6 Realm incidents (exploit / abuse on a deployed realm)

> **Realm deploys are irreversible.** A Gno realm cannot be patched in place: there is no `git revert` for on-chain code. The two levers are **pause** (stop the bleeding) and **repoint** (deploy a fixed realm at a new path and point the app at it). Plan for both *before* an incident.

**Decision tree.**
1. **Detect** — exploit report, abnormal `bank/balances` on a realm address, abuse spike, or a failing live ACL probe (§7).
2. **Decide to pause** — the operator (zxxma) decides; no quorum needed to *propose*, but the pause TX is admin-gated (below). When in doubt, pause: pausing only blocks *new* state-mutating user ops — users can still reclaim their own funds (see the per-realm exemptions).
3. **Pause** — sign + broadcast the realm's pause entrypoint from the **admin multisig** `g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0` (samcrew-core-test1):
   * `agent_registry.Pause` / `nft_market.Pause` (admin-only);
   * `memba_dao_channels_v2.PauseRealm` (owner = the same multisig at deploy).
   * **Pause is not a full stop by design** — fund-exit/unwind ops stay open: `agent_registry.RefundCredits`; `nft_market.DelistNFT` / `CancelOffer` / `ClaimExpiredOffer` / `ClaimPurchaseTimeout`; channels_v2 owner governance. This is deliberate (users must always recover escrow); see each realm's pause-policy header.
4. **Comms** — pin in `#memba` Discord + the status surface: which realm, what's paused, what users can still do (withdraw/refund), ETA. Notify DAO founders for any `memba_dao*` realm.
5. **Fix + repoint (rollback)** — patch the realm source in **`samcrew-deployer`** (the canonical realm source), deploy the fixed realm at a **new path** (e.g. `_v3`), then **repoint the frontend config atomically in one release** (the `NETWORKS`/realm-path constants). The old realm stays paused/deprecated. *Repoint is the realm rollback* — there is nothing to roll back on-chain.

**A5 — agent_registry redeploy runbook (the canonical repoint pattern).**
1. **Preconditions:** assert the old realm's bank balance == 0 and the credits ledger is empty (live-verified empty on 2026-06-10: `bank/balances/g18q5we4jm88qvggp4rmpnf63h2kvuytadggxuwr`). If non-zero at execution time, publish a refund window first (note: `RefundCredits`' send path is blocked on test12 by `restricted_denoms=["ugnot"]`, so a non-zero balance needs manual/admin handling).
2. **Deploy** the hardened `agent_registry` via `samcrew-deployer`.
3. **Repoint** the frontend realm path atomically in the same release.
4. **Verify** the new path with the live ACL/state probes (§7); record the deploy in `realm-versions.json` (G5 format: full txHash + deployer commit SHA).
5. **Rollback** = repoint config back to the old path.

### 4.7 Litestream restore drill (RPO/RTO) — W2.3

**What protects what.** Litestream streams WAL segments to the S3 replica continuously (default sync interval 1s) and takes a full snapshot every 24h, retaining 168h (7 days). This is the ONLY backup mechanism (§4.4 note): it survives volume loss (§reference: the 2026-06 volume-on-unreachable-host incident), machine loss, and region loss — anything short of losing the S3 bucket itself.

**Expected RPO/RTO (fill in measured values at the first drill):**

| Scenario | RPO (data loss) | RTO (time to serving) |
|---|---|---|
| Corrupt DB, machine alive (automatic, §4.4) | ≤ ~1s of WAL (last un-shipped frames) | one boot cycle (~30–60s) — MEASURE |
| Volume lost, new machine | ≤ ~1s of WAL | volume create + deploy + restore (~5–10 min) — MEASURE |
| S3 replica lost | everything since… nothing else exists | n/a — this is the disaster to avoid; consider bucket versioning/replication |

**Manual restore procedure (staging drill = same steps against a scratch app):**

```bash
# 0. Secrets needed (Fly secrets on memba-backend): AWS_ACCESS_KEY_ID,
#    AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3, BUCKET_NAME.
# 1. Inspect what the replica has (generations, snapshot + WAL ages → your RPO):
fly ssh console -a memba-backend
litestream generations -config /etc/litestream.yml /data/memba.db
litestream snapshots  -config /etc/litestream.yml /data/memba.db

# 2. Restore to a scratch path and sanity-check it (NEVER straight over prod).
#    NOTE: the runtime image has NO sqlite3 CLI (that's why the integrity gate
#    lives in the app binary) — row-level inspection must happen off-box.
litestream restore -config /etc/litestream.yml -o /tmp/restored.db /data/memba.db
DB_PATH=/tmp/restored.db /app/memba integrity-check
# Optional row-level check (off-box): restore to your laptop with the same
# litestream command + S3 creds, then: sqlite3 restored.db \
#   "SELECT COUNT(*) FROM transactions; SELECT COUNT(*) FROM multisigs;"

# 3. Swap it in (machine restart re-runs the boot integrity gate):
mv /tmp/restored.db /data/memba.db && rm -f /data/memba.db-wal /data/memba.db-shm
exit
fly machine restart <machine-id> -a memba-backend
fly logs -a memba-backend | grep "integrity check"   # expect "Database passes integrity check"
```

**Drill checklist (run once per quarter, ~20 min, staging or a scratch Fly app):**
1. Record the timestamps: drill start, restore complete, app healthy (`/health` 200).
2. `litestream snapshots` age at drill time → measured RPO headroom.
3. Restore + boot per the steps above → measured RTO.
4. Write both numbers into this table (replace the MEASURE placeholders).
5. Verify one known row survived (e.g. a recent transaction's final_hash).

> **The live drill itself is an ops exercise** — it needs Fly + S3 access and a
> human watching; it is deliberately NOT automated. First drill: owner zxxma.

---

## 5. Change freeze windows

Per the v7.1 plan §9.0 / §10.1:

* 24 h before/after any **Phase 5 betanet** chain-mutating TX.
* 24 h before/after a **v7.1.0 (or future major) release tag**.

During a freeze: only hotfix branches accepted to `main`. Document the freeze period at the top of `#memba` Discord and as a pinned PR comment.

---

## 6. On-call (single-operator project)

Until a secondary owner is recruited (v7.1 plan §1.8 / R-12):

* **No merges Friday 15:00 local → Monday 09:00 local** for risky phases (Phase 0, Phase 2 cutover, Phase 5 betanet activation, release windows). Dependency-only PRs may merge with explicit operator review.
* Alerts route to Slack `#memba-alerts`. zxxma is the on-call.
* Backup contact for production incidents: TBD (Phase 1 follow-up).

---

## 7. Useful commands

```bash
# Live chain probes (used in Phase 0/1 acceptance + every release)
curl -s https://rpc.test13.testnets.gno.land/status | jq .result.sync_info.latest_block_height
curl -s https://rpc.gnoland1.samourai.live/status | jq .result.sync_info.latest_block_height

# Transfer-lock probe (Phase 1.5 / Phase 5 gate)
gnokey query params/bank:p:restricted_denoms -remote https://rpc.gnoland1.samourai.live:443
gnokey query params/auth:p:unrestricted_addrs -remote https://rpc.gnoland1.samourai.live:443

# Backend
cd backend && go install golang.org/x/vuln/cmd/govulncheck@v1.3.0 && govulncheck ./...
cd backend && go test -race ./...

# Frontend
cd frontend && npm audit --audit-level=high --omit=dev
cd frontend && npm ls @clerk/shared dompurify

# Fly
flyctl releases list -a memba-backend
flyctl logs -a memba-backend --since 30m
fly volumes snapshots list memba_data
fly machine list -a memba-backend
```
