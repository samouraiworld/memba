# Memba Operational Runbook

> **Scope**: day-to-day operational procedures, recurring tasks, and incident playbooks for `memba.samourai.app` (frontend) and `memba-backend.fly.dev` (backend).
> **Owner**: zxxma (currently sole code owner — see v7.1 plan §1.8 for the planned reviewer-recruitment follow-up).
> **Audit trail**: see `docs/planning/MEMBA_V7_1_*` for the rationale behind the procedures below.

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
| Chain | `test12` (today); `gnoland1` after Phase 5 | Gno | Samourai sentry RPC: `rpc.testnet12.samourai.live` / `rpc.gnoland1.samourai.live` |

### Critical environment variables

| Var | Surface | Owner | Notes |
|-----|---------|-------|-------|
| `ED25519_SEED` | Fly | server-keypair | If empty, ephemeral keypair → every restart logs out all users. See `backend/internal/service/service.go`. |
| `GNO_CHAIN_ID` | Fly | auth | Required for AUTH-CHAINID-01 enforcement; defaults to `test12`. |
| `FLY_API_TOKEN` | GitHub Actions | deploys + GHCR mirror | |
| `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID` | GitHub Actions | Netlify deploy | |
| `SENTRY_AUTH_TOKEN` | GitHub Actions | source-map upload | Required by `@sentry/vite-plugin`; was unwired before `v6.0.2`. |
| `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Netlify + backend | Clerk auth (alerts) | Must be the *same* environment (test/live). |
| `OPENROUTER_API_KEY` | Fly | AI analyst | Rate-limited; not on the critical path. |
| `LIGHTHOUSE_API_KEY` | Fly | IPFS gateway | |

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
curl -s https://rpc.testnet12.samourai.live/status | jq .result.sync_info.latest_block_height
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
