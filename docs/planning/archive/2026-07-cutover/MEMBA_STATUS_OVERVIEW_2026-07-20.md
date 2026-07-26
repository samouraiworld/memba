# Memba — Status Overview & Decision Aid (2026-07-20)

> Third verification pass, 2026-07-20 midday (supersedes the 07-18 version). Local doc — **not for git/GitHub**.
> Sources: live probes (Netlify, Fly, test13, topaz-1 official RPC + sentry + indexer, on-chain qeval/balance), GitHub (Memba, samcrew-deployer, gnodaokit, faucet-hub), session memory.

---

## 0. TLDR — ICO day + ceremony is GO

**All three Topaz ceremony blockers are closed — independently re-verified on-chain in this pass:**
- `r/sys/names.IsAuthorizedAddressForNamespace(g1x7k4628…, "samcrew")` → **`true`** (Aeddi authorized us)
- Deploy 2-of-2 balance → **exactly 10,000 GNOT** (funded)
- Official RPC `rpc.topaz.testnets.gno.land` **live on `topaz-1`** (h=54072), **samourai sentry back and in sync** (same height), **tx-indexer `/graphql` → 200**

**Production is healthy and frozen-stable:** frontend 200, backend alive, `/metrics` 401-enforcing, test13 at h≈942k. Memba repo: **0 open PRs**, main unchanged since Jul-18, CI green. Deployer: **0 open PRs, #119–#125 all merged — ceremony-ready.**

**Today (operator):** flip `VITE_ENABLE_ICO_ANNOUNCEMENT` in Netlify env + trigger rebuild when the sale opens. The flag state is **not remotely detectable** (Vite folds it at build) — verify visually after the deploy. ⚠️ $MEMBA supply disclosure + ToS are **still open on sale day** — last call.

**Next work session = the WS-E ceremony** (owner-attended): B4 preflight (expect green — it was refusing correctly while samcrew was unauthorized) → deploy ceremony → smoke/solvency/treasury checks → C1/C2 with real URLs → gnomonitoring += topaz-1 → katana dry-run config. **Plan §12.8 is the authoritative opening checklist.**

---

## 1. Live status (probed 2026-07-20)

| Surface | State |
|---|---|
| Frontend `memba.samourai.app` | ✅ 200 (Netlify native, pinned `test13`) |
| Backend `memba-backend.fly.dev` | ✅ alive (`/api/nft/image` 400); `/metrics` 401 = `METRICS_BEARER` enforcing |
| test13 | ✅ `test-13` h=942300 |
| **topaz-1 official RPC** | ✅ `topaz-1` h=54072 |
| **topaz-1 samourai sentry** | ✅ `topaz-1` h=54072 (back up, in sync) |
| **topaz-1 indexer** | ✅ `indexer.topaz.testnets.gno.land/graphql` → 200 |
| **samcrew namespace** | ✅ authorized for `g1x7k4628…` (qeval `true`) |
| **Ceremony funds** | ✅ 10,000 GNOT on the deploy 2-of-2 |
| CI (Memba main) | ✅ green (only scheduled Security/Dependency runs since Jul-18) |

Flag posture unchanged: NFT off, Reputation off, Barricade 3D off, App Store submit off; ICO announcement = today's operator flip.

---

## 2. Changed since the 07-18 report

- **#123 MERGED** (Jul-18 08:58Z, `9b2b22e`) — CI pin `fc4052651` + tokenfactory grc20 #5908 adaptation. The tip gate was satisfied via on-chain fingerprints; release tag confirms `fc4052651`. (The CONFLICTING state I flagged resolved without drama.)
- **#125 MERGED** (Jul-18 12:11Z, `f47f31d`) — `[test14]` lane LIVE: chain_id `topaz-1`, official RPC primary, topaz-dev retired to a test fixture. **Deployer = 7 PRs (#119–#125), 0 open.**
- **All 3 human blockers closed** (Jul-20 morning session, re-verified here): Aeddi authorized + funded `samcrew`; official endpoints incl. indexer live; Lours's sentry re-synced. **katana#9 merged by Lours.**
- **gnodaokit#65 finalized to avl-only** ("Q13 final form": avl repoint + svg boundary, 7 files) — still OPEN, gated on CI retool or owner+David say-so; alternative is deploy-from-branch at ceremony time. (#5048 upstream would have blocked /v2 publishes anyway — the rename-strip dodged a landmine.)
- **faucet-hub#81 OPEN** (gnolang/faucet-hub, "add topaz faucet") — end-user faucet, explicitly NOT a ceremony blocker.
- Memba repo itself: no new merges since Jul-18 (tip `4a67feb4`); dependabot quiet.

---

## 3. Repository status

- Memba main checkout: **still detached HEAD** (`e8834f3c`-era); `main` held by the barricade worktree at origin tip. Branch off `origin/main` for new work.
- Deployer + gnodaokit + katana: clean, 0 open PRs each (except gnodaokit#65 by design).
- 10 untracked docs in `docs/planning/` (this overview replaces the 07-18 one).

---

## 4. Awaiting YOU

**Today (ICO day):**
1. Flip `VITE_ENABLE_ICO_ANNOUNCEMENT` + Netlify rebuild when the sale opens; verify the popup visually.
2. **$MEMBA supply disclosure** — still absent at sale open. Highest-priority copy task.
3. **ToS / Privacy** — same.
4. Watch the wave: `/metrics` is scrapeable now; `QUEST_ADMIN_ADDRESSES` still unset (small).

**Ceremony (next session, owner-attended):**
5. Run plan §12.8: B4 preflight → WS-E deploy ceremony (publish order per §11.3; gnodaokit#65 branch = fork source — decide merge vs deploy-from-branch with David) → smoke/solvency/treasury → C1/C2 real URLs → gnomonitoring += topaz-1 → katana dry-run config.
6. Budget note: gas metering #5892 is active on topaz-1 → pilot deposit numbers are stale-low; **re-derive every deploy budget via `gnokey -simulate only`** during the ceremony.

**Standing queue (unchanged):** Tracks 1–7 approval · Wave-1 plan · marketplace pilot shape · BARRICADE §10 · NFT collection launch · marketplace-v2 #851 · Lours valset entry (VALIDATOR.md + GovDAO; sentry part done).

---

## 5. Planned work map

1. **Topaz WS-E ceremony** — everything mechanical is done; the ceremony itself is the next milestone. After it: memba_dao follow-up (zero-import repoint), A5 emit-cap sweep (349 sites), B3 test-strip/deposit-budget vs live params, C3 backend, Memba `GNO_PIN` + template flip (WS-E), `[test14]` chain flip via `netlify.toml` PR when Memba itself migrates. ⚠️ #960's error patterns are Topaz-broken (namereg nym-lock) — port during WS-E. P4 katana: dry-run config vs topaz-1 first; arming stays owner-gated (GovDAO signer).
2. **Feed v2 Waves C–F** → ONE immutable feed_v2 deploy.
3. **Whole-project Tracks 1–7** — pending approval.
4. **Feature-completion program** (~15 features) — pending pilot-shape OK.
5. **BARRICADE 3D** — post-mainnet; arm choice pending §10.
6. **Deployer** — NF-2 solvency at version-cut (ceremony includes solvency check).

---

## 6. Risk register

| Risk | Exposure | State |
|---|---|---|
| No ToS / supply disclosure **at sale open** | Legal/trust, live today | ❌ owner — last call |
| ICO flag flip needs rebuild + visual check | Silent no-op on sale day | ⚠️ operator runbook §4 |
| Ceremony deposit budgets (gas #5892 active) | Mid-ceremony stall / underfunding | ✅ known — `-simulate only` per deploy; 10k GNOT ≫ pilot's 12.85 |
| gnodaokit#65 merge path undecided | Ceremony source-of-truth ambiguity | ⚠️ decide with David: merge (CI retool) vs deploy-from-branch |
| #960 error patterns Topaz-broken | Bad deploy UX after Memba's chain flip | ✅ tracked for WS-E, not urgent today |

**Closed since 07-18:** samcrew prereg (authorized + funded) · topaz-1 RPC/indexer/sentry dark (all live) · #123 conflict (merged) · Monday triple-collision (Topaz side landed early; only ICO ops remain today).

---

## 7. Suggested next sessions

1. **Today:** ICO ops only (flip + visual check + watch metrics). Ship disclosure + ToS copy if at all possible.
2. **Ceremony session (owner-attended, soonest convenient):** plan §12.8 end-to-end. Pre-reads: `MEMBA_TEST14_TOPAZ_MIGRATION_AAA_PLAN_2026-07-17.md` §11.3/§12.8 + `TOPAZ_PLAN_PRESSURE_TEST_2026-07-17.md`.
3. **Post-ceremony:** memba_dao follow-up, A5, B3, C1/C2 verification, gnomonitoring + katana dry-run.
4. **Then:** Feed v2 Wave C, Tracks 1–7 kickoff, feature-program shape decision.
