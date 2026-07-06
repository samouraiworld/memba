# Owner Unlocks — post-Wave-7 (2026-07-04)

**What this is:** the detailed, do-this-to-unlock-next-steps recap. All Wave 7 code
is merged and clean — nothing below is blocked on more code. These are the levers
only you can pull (deploys, secrets, on-chain ceremonies, branch protection,
strategy calls).

**State at hand-off:** `Memba` main = `e92c8a5` · `samcrew-deployer` main = `37f90ae` ·
zero open PRs, clean trees. 9 PRs shipped this session (feed realm+indexer+UI,
My Listings, activity bot, deep-review fixes), each independently reviewed + CI-green.

**Dependency map (what unlocks what):**
```
A. Turn feed ON ──────────────► users can post/read the feed
B. Activity bot (optional) ───► feed/marketplace look alive at launch
C. U-1 restore drill ─┐
   U-3 A3 flip ───────┴───────► WAVE 8 (money-path work) can start
D. U-2 secrets ───────────────► W6.5 PR2 (backend Sentry) + closes /metrics hole
   U-9 branch protection ─────► the changelog CI gate becomes binding
E. U-6a / U-8 / U-10 ─────────► frame Wave 8/9 (decisions, no deadline)
```

---

## A. Turn the social feed ON  (the Wave 7 headline)

Off by default everywhere. Three steps, **in this order** (the realm must exist
before the indexer watches it, and the indexer should be running before the UI
flag exposes an empty page).

### A.1 — Deploy the `memba_feed_v1` realm to test13  (on-chain, multisig)

The realm source is merged in the deployer (incl. the deep-review orphan-leak fix)
and registered in `projects/memba/deploy.sh`.

> ⚠️ **Use the `REALM=` filter.** Plain `make deploy PROJECT=memba` walks the whole
> memba sequence, and `memba_token_otc_v1` (a **fund-moving OTC realm**) is registered
> but NOT yet on test13 — so a bare deploy would co-deploy it. `REALM=memba_feed_v1`
> pins it to just the feed. (Note: `make plan` uses a separate illustrative list that
> omits feed/otc — do NOT use it as the preview; use `make deploy-dry` below, the real
> driver.)

```sh
cd ~/Desktop/Code/Gno/samcrew-deployer

# 1. Dry-run through the REAL driver — must show ONLY memba_feed_v1 as "DRY",
#    everything else "SKIP" (Total: 1 Dry, 7 Skip):
REALM=memba_feed_v1 make deploy-dry NETWORK=test13 PROJECT=memba DEPLOY_KEY=samcrew-core-test1

# 2. Real deploy (samcrew-core-test1 multisig signs; deploy_with_retry handles it):
REALM=memba_feed_v1 make deploy NETWORK=test13 PROJECT=memba DEPLOY_KEY=samcrew-core-test1
```

**Verify (on-chain):** the realm renders and the stats read empty:
```sh
gnokey query vm/qrender --data "gno.land/r/samcrew/memba_feed_v1:" \
  -remote https://rpc.test13.testnets.gno.land:443
# or qeval GetStatsJSON() → {"livePosts":0,"nextPostId":1,"tombstones":0,"paused":false}
```
The feed realm holds **no funds** (no banker), so this is a plain addpkg — no fee-path
risk. If the dry-run shows anything OTHER than `memba_feed_v1` as "DRY", STOP and check.

> **`memba_token_otc_v1` is a separate decision.** It's the OTC token-swap realm —
> ready but never deployed on test13, its frontend lane gated off
> (`VITE_ENABLE_TOKENS=false`), its message-builder bug fixed this session. Deploy it
> deliberately (`REALM=memba_token_otc_v1 make deploy …`) only when you want to light up
> the token lane — never as a side effect of the feed deploy. Never redeploy a frozen
> realm (esp. `tokenfactory_v2`).

### A.2 — Point the backend indexer at the realm  (Fly env)

The feed indexer is a decoupled tailer that starts only when `FEED_WATCHED_REALMS`
is set (it's a no-op until then — that's why it's safe already on prod).

```sh
flyctl secrets set FEED_WATCHED_REALMS="gno.land/r/samcrew/memba_feed_v1" -a memba-backend
# (optional) FEED_RPC_URL defaults to NFT_RPC_URL; FEED_START_BLOCK defaults to 260000
```

**Verify:** after the machine restarts, the boot log shows the feed tailer starting
and, once you post, `feed_posts` rows appear. `GET /rpc … GetFeedTimeline` returns
the post within a few blocks.

### A.3 — Expose the UI  (Netlify env, then it's live)

`VITE_ENABLE_FEED` is an ordinary flag (no funds), so it just flips — no
`SAFETY_GATED_FLAGS` edit needed.

- In **Netlify → Site config → Environment variables**, set `VITE_ENABLE_FEED = true`
  and trigger a deploy (prod deploys are Netlify-native via `netlify.toml` — do NOT
  use `deploy-frontend.yml`).

**Verify:** `/feed` renders the timeline (not the Coming-Soon gate); the sidebar
"Feed" entry loses its "soon" pill; connect a wallet → compose a post → it appears
optimistically and reconciles against the indexer.

> Roll back any step independently: unset the Netlify var (UI hides), unset
> `FEED_WATCHED_REALMS` (indexer stops), the realm can stay deployed harmlessly.

---

## B. Activity bot — make it look alive  (optional, testnet-only)

Only if you want ambient activity during launch. Full procedure in
`backend/docs/ACTIVITYBOT_RUNBOOK.md`; the essentials:

1. **Fresh throwaway test13 key** (never reuse): `gnokey add activitybot`; record the
   mnemonic offline; log its address.
2. **Fund from the faucet only**, faucet-scale (a few GNOT). Never more.
3. **Secret**, never in the repo: `flyctl secrets set ACTIVITYBOT_PRIVKEY="<mnemonic>"`.
4. **Schedule** via a GitHub Actions `schedule:` job (Fly has no declarative cron)
   with a `concurrency:` group (single scheduler — the daily-cap counter is not
   locked), running with `ACTIVITYBOT_ENABLED=true … -broadcast`. Persist the
   `state.json` across runs.
5. Edit `scenario.json` for what it does. Safety rails are hard constants:
   `MaxTransfersPerDay=100`, `MaxTransferUgnot=1 GNOT`, `MaxActionsPerRun=25`,
   kill-switch `ACTIVITYBOT_ENABLED`.

Kill switch: unset `ACTIVITYBOT_ENABLED` → next run is a clean no-op.

---

## C. Wave-8 hard gate — the two blockers  (money-path work can't start without both)

Wave 8 (fund-safety: DAO v1→v2 migration, hardened `agent_registry` redeploy,
treasury-spend UI) is **hard-gated**. Do these two and I can pick up Wave 8.

### C.1 — U-1: first Litestream restore drill  →  `docs/OPS_RUNBOOK.md §4.7`

Proves the backups actually restore (untested backups = no backups; it's a Wave-8
gate input). On the backend machine:
```sh
litestream snapshots -config /etc/litestream.yml /data/memba.db   # generations + ages = your RPO
litestream restore  -config /etc/litestream.yml -o /tmp/restored.db /data/memba.db
memba integrity-check /tmp/restored.db                            # PRAGMA integrity_check
```
Then fill the **RPO/RTO MEASURE placeholders** in §4.7's table (snapshot age = RPO;
restore+boot time = RTO). That table currently has blanks — filling them is the
deliverable.

### C.2 — U-3: flip A3 multisig enforcement  →  `docs/MULTISIG_ENFORCE_RUNBOOK.md`

The code side is done (#734); this is now **metric-gated**, not code-gated. Gates 1–2
(capture a real Adena signature, prove it verifies as a committed fixture) — only if
not already green. Then **Gate 3**:
1. With `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY` unset (log-only), watch the metric
   `multisig_sig_verify{result=...}`.
2. When `result=ok` is ~100% (no `result=mismatch` from legit signers) on recent rows,
   set:
   ```sh
   flyctl secrets set MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1 -a memba-backend
   ```
   Rollback = unset it (unset IS log-only). **Do not flip until the metric reads
   mismatch=0.** This one is USER-ONLY — never flip it from a session.

---

## D. Other standing owner actions  (not Wave-8 blockers)

### D.1 — U-2: set prod secrets  →  unlocks W6.5 PR2, closes a scrape hole
```sh
flyctl secrets set METRICS_BEARER="<random-32+ char token>" -a memba-backend
flyctl secrets set QUEST_ADMIN_ADDRESSES="g1...,g1..." -a memba-backend   # your admin addrs
```
Until `METRICS_BEARER` is set, `/metrics` is publicly scrapable and the backend logs a
startup warning. Setting it unblocks the backend-Sentry PR2 (W6.5).

### D.2 — U-9: make the changelog CI gate binding  (phone, 1 min)

The `Changelog entry` check runs on every PR but is inert until required.
- **GitHub → Settings → Branches → `main` branch protection → Require status checks →**
  add the check named **exactly** `Changelog entry`.

---

## E. Decisions I need from you  (chat, no deadline — they frame Wave 8/9)

- **U-6a — AMM framing:** is the AMM a *core identity pillar* (build even at gas
  parity if the UX story wins) or an *option* (KILL threshold binding)? Determines
  how the Wave-9 AMM spike data is read.
- **U-8 — fee policy per lane:** the treasury fee bps for each lane
  (nft / service / token / amm / appstore). The fee spine exists; the numbers are
  a business call.
- **U-10 — "first 100 users" motion:** the outreach/content/quests on-ramp, so W7's
  launches don't ship to a ghost town.

---

### TL;DR order of operations
1. **A.1 → A.2 → A.3** to turn the feed on (do these together).
2. **C.1 (restore drill) + C.2 (A3 flip)** — the two Wave-8 unlocks; do whenever ready.
3. **D.1, D.2** whenever convenient (small, independent).
4. **E** answers in chat when you've thought about them.
5. Ping me once C.1 + C.2 are done and I'll start Wave 8.
