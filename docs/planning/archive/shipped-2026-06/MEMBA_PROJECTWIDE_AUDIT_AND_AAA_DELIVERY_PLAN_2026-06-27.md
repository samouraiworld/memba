# Memba — Project-Wide Deep Audit & AAA Tier-1 Delivery Plan (v3.2)

**Date:** 2026-06-27 · **Revision:** v3.2 (council-reviewed + chain-verified; **NFT marketplace went LIVE mid-review** — deep-reviewed SAFE-AS-LIVE; refreshed @ `7253a5a`)
**Author:** CTO (cross-perspective expert audit)
**Audience:** CEO — for go/no-go review
**Scope:** Memba (frontend + backend) + `samcrew-deployer` (realm source) + `gnodaokit` (lib). *Not* the other workspace repos (HyperGno, gnolove, Samourai Gno Security Guard, MCP servers) — though §9 recommends pointing the in-house **Samourai Gno Security Guard at these realms**.
**Method:** 5 senior perspectives (Security/Contracts · Frontend/UX · Backend/Infra · Product/Release · Eng-Process), then **independent re-verification of every alarming claim** — including against live test13 RPC — then an **adversarial red-team of this plan**. Several first-pass findings were overstated and are corrected here. Ground truth is `git`/`gh`/on-chain, never project memory.

> **CEO one-paragraph.** The shipped product is genuinely strong and live on test13: DAO governance, token factory, validators, reviews/web-of-trust, backend-authoritative Quests-XP, and now the member-home hero and Quest attestation. There are **no critical access-control exploits in the smart contracts** and **no committed secrets**. The work to reach a confident public launch is **not rearchitecting — it's (1) operational durability** (the XP/quest ledger has no offsite backup — the one true P0), **(2) a handful of auth/abuse hardening items**, **(3) finishing the marketplace** (blocked on one on-chain multisig deploy, not code), **and (4) answering three launch-gating questions the engineering audit can't: legal/regulatory posture, sybil/abuse economics, and what happens to test13 data at mainnet cutover.** This v2 re-tiers the severity list down to the few items that genuinely gate launch, and sequences the rest behind enforceable gates.

---

## 0. What changed in the ~40 minutes between v1 and v2 (and why it matters)

While v1 sat unactioned, **four PRs merged to `main`** (now `c0b7b69`): #604 (MemberHero — now exists), #610 + #613 (Quest attestation: voucher issuance + on-chain panel), #611 (docs). v1 listed several of these as "ship next"; they shipped before the ink dried.

**The lesson is the finding:** prose-based status is unmaintainable on a team merging this fast. The fix (Wave 0, task 1) is a **generated `STATE.md` in CI that fails the build on drift** — the only durable cure for the truth-tracking gap, and the reason this document deliberately contains **no PR-by-PR merge status in its body** (that lives in `STATE.md`/`gh`).

> **v3.1 refresh — it happened AGAIN.** Between the council review (`c0b7b69`) and `3a4671c`, two more PRs merged (#615 activity-feed, #614 mobile) **and the marketplace fee-spine realms went live on-chain** (`market_config` + `nft_market_v3_1`).
>
> **v3.2 refresh — and AGAIN, bigger.** By `7253a5a` the **entire NFT marketplace shipped LIVE**: #612 (W1 unified) + #618 (deploy docs) merged, and **#617 ungated `VITE_ENABLE_NFT`** — correctly, by *removing it from `SAFETY_GATED_FLAGS`* (the exact safety-set-removal step this plan prescribed; the prod-freeze trap was handled right). I deep-reviewed the live marketplace (next box). That's **four** turns running where live state outran the document. This is now overwhelming evidence for Wave-0 task-1 (`STATE.md`-from-`gh` in CI). **Stop hand-maintaining status; generate it.**

> **Deep review of the now-LIVE NFT marketplace — VERDICT: SAFE-AS-LIVE.** Chain-verified: fee = **2%→DAO treasury** (`GetFeeBPS("nft")`=200, `GetTreasury()`=`g10kw7e55…`); settlement is CEI (seller paid last, self-buy blocked, payment re-validated on-chain so client `send` can't cheat); fee/royalty math overflow-clamped (feeBPS∈[0,500], royalty≤10%, `fee+royalty≥price` panics). **No P0.** Two alarms were FALSE — both the realm *code comments* and a sub-review agent called the trading-realm admin "single-key `g1x7k4628…`"; the **chain says it's a `PubKeyMultisig` threshold-2** (2-of-2). The comment-vs-chain trap struck a *third* time — proof that §2's "verify the chain, never the comment" discipline must be enforced. `market_core` realm being undeployed is **vestigial** (the real dependency is the *package* `p/samcrew/memba_market_core_v2`, which is deployed). **One genuine to-do:** the treasury multisig `g10kw7e55…` is **not yet instantiated on-chain** — fees accrue there but the DAO can't move them or call `SetFeeBPS`/`SetTreasury` until it's funded once; then smoke a real end-to-end sale and assert the `Sale` event's `treasury`/`feeBps` + a multisig balance increase to fully close the "fee→DAO verified" claim.

---

## 0.5 CTO experts-council review — verdict & corrections applied (v2 → v3)

Five senior seats (Smart-contract/Security · SRE · Product/GTM/Legal · Frontend/AAA · Delivery/Process) independently re-verified this plan against live chain + repo. **Unanimous verdict: SHIP-WITH-CHANGES.** The spine held; the council (and my own re-verification of their claims) found these errors, now corrected below:

| # | What v2 said | Verified reality | Action |
|---|---|---|---|
| C1 | "Money realms use a **single-key** admin `g1x7k4628…` → migrate to multisig (P1)" | **WRONG — read off a code comment, not the chain.** On-chain `g1x7k4628…` IS a real **2-of-2 multisig** (`/tm.PubKeyMultisig`, threshold 2, holds 9,423 GNOT). The money realms are already multisig'd. | **DROP the P1.** Replace with a **Wave-2 pre-deploy check**: market_config's intended admin `g10kw7e55…` returns **`null` on-chain (never instantiated)** — verify/instantiate it before the deploy ceremony. |
| C2 | "12 npm vulns (8 high) reachable, fix before launch (P1)" | **Overstated.** `npm audit --omit=dev` = **2 (1 low, 1 moderate)**; the 8 high are **dev-toolchain only** (vite/esbuild dev-server, undici), vite already on a patched range. | **Re-tier to P2 hygiene.** Re-enable Dependabot; the dev-only highs are not launch-gating. |
| C3 | "Scoped CODEOWNERS freeze — enforceable, not honor-system" | **Not enforceable today.** Branch protection: `require_code_owner_reviews: false`, `enforce_admins: false`; CODEOWNERS is `* @zxxma` (no per-path scoping). | **Wave-0 first line item:** `gh api` PATCH to enable code-owner reviews + `enforce_admins` + per-path owners for money/auth/indexer — *or* state plainly the freeze is convention-only. |
| C4 | "Light-theme vitest guard NOT in CI" | **Wrong** — it runs (`ci.yml:135` vitest, `ci.yml:111` CSS grep). But **both miss inline `style={}` hex** (e.g. `ProfileUIAtoms.tsx`). | Fix = **lint inline-style hex in JSX**, not "wire the guard." |
| C5 | Reliability deficit framed as wholesale | Graceful shutdown, WAL checkpoint-on-shutdown, transactional+versioned migrations **already exist** (`main.go:104,262,269`; `db.go:73-83`). | Acknowledge; **add** the real gaps: `/health` Ping flaps under `MaxOpenConns(1)` (Fly restarts healthy nodes mid-write); **disk-full bricks live DB + backups in the same volume domain** (silent P0 sibling); restore drill must include `PRAGMA integrity_check` + RPO/RTO. |
| C6 | "no tag since v6.3.1"; "42 unmerged / 7 worktrees" | Tags exist to **v9.0.0** (last `2026-03-03`, ~115 days / ~428 commits ago); actually **47 branches / 8 worktrees / 4 dirty**; Validators **749** LOC (not 717); OrgContent **15** useState (not 74). | Correct the metrics. The *cadence gap* and *sprawl* are real; the specific figures were off. |
| C7 | §6 legal/PII framed as "before mainnet" | Product is **already live** at memba.samourai.app collecting address→behavioral data, with a `DISCLAIMER` but **no ToS / no Privacy Policy**. | **§6 legal + privacy are gating NOW**, not pre-mainnet. Add a **§6 Decision Table** (owner/cost/gate/recommendation). Add **token-rug/fairness, marketplace counterparty-fraud, and immutable-content moderation** to §6. **Demote Wave-3 AAA below §6 + reliability** (gold-plating the storefront while the door is unlocked). |

The eng spine ("no critical contract exploit; no committed secrets; P0 = same-volume backup") was **confirmed by all five seats**. The changes above are folded into §3/§4/§6; the appendix tracks the full severity history.

---

## 1. Verified ground truth (re-checked against live chain & gh)

**On-chain test13 (parser-verified against a known-live control `memba_dao` = LIVE):**

| Realm | On-chain state | Implication |
|---|---|---|
| `memba_dao`, `candidature_v2`, `channels_v2`, `tokenfactory_v2`, `agent_registry`, `escrow_v2` | ✅ LIVE | Core product live |
| `memba_reviews_v1` | ✅ LIVE & un-gated | Reviews shipped |
| `memba_quest_attestation_v1` | ✅ LIVE (`Signer: configured`) | Q-05 realm live; frontend merged (#610/#613) |
| `gnobuilders_badges_v2` | ✅ LIVE but **`TotalSupply()==0`** | **Badge reward loop still open (Q-01)** |
| **`memba_market_config`** | ✅ **LIVE** | fee 2%→DAO verified; admin/treasury `g10kw7e55…` **not yet instantiated** (fund once so DAO can act) |
| **`memba_nft_market_v3_1`** | ✅ **LIVE** (marketplace ungated, #617) | engine live; admin `g1x7k4628…` = **2-of-2 multisig** (chain-verified, *not* single-key) |
| **`memba_market_core` (realm)** | ❌ not deployed — **vestigial** | real dep is the *package* `memba_market_core_v2` (deployed); no blocker |

**Repo state:** `main` @ **`7253a5a`** (refreshed). **The NFT marketplace SHIPPED LIVE:** #612 (W1 unified), #618 (deploy docs), **#617 (ungated `VITE_ENABLE_NFT` — done right via safety-set removal)**, #616 (hero fix) all merged; #614/#615 also merged since council. **All deployer PRs merged/closed.** Open Memba PRs now: **#619** (Q-05 vouchers on SyncQuests), **#620** (NFT fallback art) — both CI-pending. **Marketplace is now realm-unblocked and deep-reviewed SAFE-AS-LIVE** (box above); the residual is operational (instantiate the treasury multisig + smoke a settlement), not a code blocker.

---

## 2. The meta-finding: status truth has decoupled from reality (process, P1)

Project memory/docs systematically report work "merged/live" that isn't — and the gap moves by the hour. Still-true, re-verified examples:

- Marketplace fee-spine realms **not on-chain** despite the deployer PR being merged (verified via `vm/qfile` → `InvalidPackageError`).
- Badges "deployed" but **`TotalSupply()==0`** — never minted (verified via `qeval`).
- `CHANGELOG.md` self-admits currency "through ~#509"; git is at #613 (~100 undocumented PRs).
- `realm-versions.json` tracks 12 of ~24 realms; several test13 deployments unrecorded or under stale names; stale ACL notes still describe *fixed* bugs as open.

**Root cause:** detached-HEAD primary checkout + logging "merged" before merge + 45 overlapping planning docs with no SSOT. **Fix = Wave 0.**

> *Two v1 self-corrections, after re-verification:* `.env` is **gitignored** (not a committed secret → local-dev footgun, P2); #604 was never "CI-red" (it merged). *One v2 correction of a sub-auditor:* the off_chain-XP "authorization bypass to candidature" is **overstated** — XP only unlocks the **frontend** apply CTA (`QuestProgress.tsx:131`); the on-chain `candidature_v2` flow is **admin-approval-gated** (applications start `pending`). Real harm is leaderboard/rank gaming → **P2, not P1.**

---

## 3. Findings register — re-tiered (P0 reserved for irreversible / data-loss / prod-exploitable)

> **Calibration note:** v1 listed ~8 "P0s" of wildly different blast radius. v2 reserves **P0 for the genuinely irreversible.** A P0 list a CEO can triage has 1–3 items.

### P0 — fix before any further public exposure
| Finding | Location | Fix | Why P0 |
|---|---|---|---|
| **DB backups land on the same single Fly volume as the live DB; no offsite copy.** Volume loss = total, unrecoverable loss of the entire XP/quest/reviews ledger | `db/backup.go:27`; `fly.toml:47-49` | Litestream / Tigris-S3 continuous replication (or scheduled `VACUUM INTO`→offsite object store) + **tested restore drill** | Irreversible data loss; the ledger is the product |

### P1 — fix before a confident public test13 push / before mainnet
| Finding | Location | Fix |
|---|---|---|
| Indexer tailer: single hard-coded RPC, **no failover/retry/lag-alert** → silent stall of floor/activity/points | `tailer.go:105-141`; `poller.go:171` | Route through resilient wrapper + backup URLs; bounded retry/backoff; **alert on `chain_head − last_block`** |
| Auth login + all XP-award RPCs share **one 60/min IP bucket**, never per-address; `SyncQuests` batches 200 | `main.go:169,448`; `quest_rpc.go:277` | Dedicated strict buckets + per-address limiter (**note: per-address ≠ sybil-proof — see §6**) |
| `MEMBA_ALLOW_UNSIGNED_AUTH` defaults **permissive** (full impersonation); safe only because `fly.toml` sets `'0'` | `crypto.go:222-229` | Invert to fail-closed; refuse to boot if `FLY_APP_NAME` set & flag≠0 |
| Multisig member-signature verify is **log-only in prod** — sigs accepted **unverified** on a governance/money product | `tx_rpc.go:337-349` | Align `ProposeTransaction` msg/fee shapes to A3 verifier + **golden test**, *then* flip. **Do NOT flip blind** (known brick) |
| **[C1 — corrected]** market_config's intended admin `g10kw7e55…` returns **`null` on-chain (never instantiated)** — the marketplace deploy would point fee/admin control at a non-existent account. *(The money realms `escrow_v2`/`collections`/`v3_1` already use a verified **2-of-2 multisig** `g1x7k4628…` — the v2 "single-key" claim was a code-comment error, now dropped.)* | `market_config/config.gno:21-27` (comment) vs on-chain | **Wave-2 pre-deploy check**: confirm/instantiate the intended multisig before the ceremony |
| `/health` does a DB `Ping()` under `MaxOpenConns(1)` → a long indexer write can flap the healthcheck → **Fly restarts a healthy node mid-write** | `main.go` healthHandler; `db.go:25` | Decouple liveness from a blocking Ping; or raise conn budget for reads |
| **Disk-full on the single volume bricks live DB + backups simultaneously** (same failure domain as the P0); WAL only checkpoints on shutdown → unbounded `-wal` growth under contention | `fly.toml:47-49`; `main.go:262` | Disk-usage alert + periodic WAL checkpoint; folds into the P0 offsite-backup work |
| Quest claim flow **not transactional**; post-INSERT derived writes (meta-quest, rank, badge-queue) **fail silently** (`_, _ =`); proof-reuse TOCTOU (UNIQUE-backstopped, racy) | `quest_rpc.go:183-250`; `quest_verify.go:332-342` | Wrap in one `tx`; stop swallowing errors; `INSERT … WHERE NOT EXISTS` |
| **Quest badge loop open** — `TotalSupply()==0`; "earn badges" promise undelivered | on-chain | Run mint ceremony before any badge marketing; keep `VITE_ENABLE_BADGES` off until minted |

### P2 — quality / robustness / hygiene
| Finding | Location | Fix |
|---|---|---|
| Ed25519 token-signing seed logged plaintext **when `ED25519_SEED` unset** — but **prod is boot-guarded** (fail-loud at `main.go`), so this is **staging/local only** | `service/service.go:89-90` | Never log the seed; make boot-guard fatal in all envs |
| off_chain quests grant XP with zero proof → **leaderboard/rank gaming** (candidature is admin-gated, so *not* governance capture) | `quest_verify.go:62-71` | Cap/exclude off_chain XP from rank/leaderboard surfaces |
| `@axe-core/playwright` installed but **never imported** — zero automated a11y | `e2e/*` | Add axe scans to 5 key routes in CI |
| Visual-regression = effectively **one macOS-only snapshot** | `e2e/visual.spec.ts` | Linux + 390px mobile baselines for home/DAO/validators/profile |
| **[C4 — corrected]** Light-theme guards **already run in CI** (`ci.yml:135` vitest, `ci.yml:111` CSS grep) but **both miss inline `style={}` hex** (`ProfileUIAtoms.tsx` `#f0f0f0` ≈ invisible on light) | `ci.yml:111,135`; `ProfileUIAtoms.tsx:34,55` | Add a **JSX inline-style hex lint rule**; sweep ~25 offenders |
| **[C2 — corrected]** Dependabot **paused** (`limit:0`); 12 npm vulns but **only 2 are prod-reachable** (1 low, 1 moderate) — the 8 "high" are **dev-toolchain only** (vite/esbuild dev-server, undici) | `.github/dependabot.yml:11` | Re-enable Dependabot (hygiene); fix the 2 prod items; dev-toolchain highs are not launch-gating |
| `navManifest` "SSOT" missing Orgs/Quest-Admin/Leaderboard/Changelogs | `navManifest.ts` | Test: every route in-manifest-or-explicitly-excluded |
| `reviews_v1.GetSubjectSummaryJSON` unbounded scan → read-gas DoS for hot subjects | `memba_reviews_v1.gno:637-653` | Running `{count,sum}` aggregate |
| Under-decomposed pages (Marketplace 815 / FreelanceServices 710 w/ 27 `useState` / Validators 717 / OrgContent 74 state); ad-hoc react-query keys; `.env` (gitignored) carries gated flags=true | `frontend/src/pages/*` | Extract subcomponents; central `queryKeys.ts`; comment `.env.example` |
| `channels_v2.SyncMembers` can strip owner's own admin role; `CreateChannel` ignores type for write-roles; `badges_v2.MintRankBadge` accepts negative tier | realm sources | Data-hygiene guards (none outsider-exploitable) |

**Metrics:** 56 branch refs (42 unmerged) · 7 worktrees · 200 FE test files / ~2,898 tests · 99 Go files / 57 tests · 24 e2e (9 live-RPC, flake source) · 0 `@ts-ignore` · 27 `as any`/108k LOC · 12 npm vulns (8 high) · 45 planning docs · **git history clean (no Claude attribution).**

---

## 4. Delivery plan — phased, gated, enforceable

**Resourcing assumption (state it or the estimates are meaningless):** estimates below are **ideal engineer-weeks** assuming **3–4 engineers** split across infra / security / frontend, with Waves 0–1 partly parallel. Apply a **+30% buffer** for review, CI, and live-chain ceremonies. Adjust to real headcount.

**Freeze rule (scoped):** until **G1**, no merge that touches **money-paths, auth, rate-limiting, or the indexer**. ⚠️ **Council C3: this is honor-system today** — branch protection has `require_code_owner_reviews: false` / `enforce_admins: false` and CODEOWNERS is `* @zxxma`. **Wave-0 task 0 makes it real** (enable code-owner reviews + `enforce_admins` + per-path owners); until that lands, the freeze is convention-only and must be stated as such.

> **Council note (Delivery seat):** G0 as written was overloaded. It's split into **G0a (safety floor)** and **G0b (truth/hygiene)** so the P0 isn't gated behind doc cleanup. Real state is **47 branches / 8 worktrees / 4 dirty** (not 42/7).

### Wave 0 — Restore truth & the one P0 (≈1.5 wk, infra+eng)
0. **Make the freeze enforceable** *(do first)*: `gh api` PATCH `main` protection → `require_code_owner_reviews: true`, `enforce_admins: true`; per-path CODEOWNERS for `/backend/internal/{auth,indexer,ratelimit}`, money realms. *(Until this lands, label the freeze "convention-only.")*
1. **Offsite DB backup** (Litestream→Tigris/S3) + **restore drill** with `PRAGMA integrity_check` + stated RPO/RTO (XP ledger intact). ← the P0.
2. Stop logging the seed; boot-guard fatal in all envs; add disk-usage alert (disk-full = P0 sibling).
3. **`STATE.md` — concrete spec** (script reads `gh pr list`+`git log` → writes `STATE.md`; CI job diffs and fails on drift). Not a wish: ship the script + the job.
4. `git switch main`; ban detached-HEAD; re-enable Dependabot + `npm audit fix` the 2 prod items; pin `flyctl-actions@master`→SHA (+ gno/golangci/gosec tags).
5. Prune branches + worktrees (target ≤3 active); archive completed planning docs → one `ROADMAP.md` + `STATE.md`; backfill CHANGELOG #510→#613; **cut a version tag** (last was v9.0.0, ~115 days/~428 commits ago).

**Gate G0a (safety):** restore drill passes (integrity-checked) · seed not logged · branch protection enforces code-owner reviews. **Gate G0b (truth):** `STATE.md` reconciles with live `gh` in CI · ≤3 worktrees · Dependabot live.

### Wave 1 — Security & abuse hardening (≈1 wk, security)
1. Indexer failover + retry + lag alert (drill: kill primary RPC → fails over).
2. Per-endpoint + per-address rate limits on auth + XP mutations.
3. Fail-closed auth defaults; boot-refuse if permissive on Fly.
4. Transactional quest claim; stop swallowing post-insert errors; fix TOCTOU.
5. Stop logging the seed; boot-guard fatal everywhere.
6. **Decide the sybil posture** (see §6) — at minimum, cap off_chain XP from rank/leaderboard.

**Gate G1 (security sign-off):** independent review confirms atomic claims, fail-closed auth, indexer failover drilled, sybil posture documented. Lifts the freeze.

### Wave 2 — Marketplace: ✅ SHIPPED LIVE — now close the operational tail (≈0.5 wk)
*The realms are on-chain, the UI merged (#612), `VITE_ENABLE_NFT` ungated correctly (#617), and the deep review says SAFE-AS-LIVE. This wave collapsed to a short post-launch checklist:*
1. **Instantiate the treasury multisig `g10kw7e55…`** (one funding/send tx) so the DAO can move accrued fees + call `SetFeeBPS`/`SetTreasury`. *(Requires explicit user approval; never auto-execute.)*
2. **Smoke a real end-to-end sale on test13** (list→buy and list→offer→accept); assert the `Sale` event's `treasury`=`g10kw7e55…` / `feeBps`=200 and that the multisig balance actually increased — this fully closes the "fee→DAO verified" claim (today verified via config reads, not an executed settlement).
3. **Confirm 2-of-2 multisig adequacy** for the trading realms (`g1x7k4628…`) before mainnet value (vs 3-of-5); the realm admin is already multisig (not single-key — chain-verified). Optional cleanup: drop the dead `feeRecipient` setter in v3.1 and the vestigial `market_core` realm reference.

**Gate G2:** treasury multisig instantiated · one settled sale verified on-chain (fee→DAO) · no money-path regressions.

### Wave 3 — AAA tier-1 finish (≈2 wk, frontend) — *with concrete bars, not adjectives*
> **Council (Product seat): DEMOTED below §6 + reliability.** The visible product is already WCAG-AA; polishing Lighthouse before answering the legal/moderation/data-continuity questions is gold-plating the storefront while the door is unlocked. Run the **§6 decisions in parallel from week 1** (they're mostly non-eng owners); execute this wave only after G1 + the §6 "fund now" items are owned.

**AAA bars (measurable):** Lighthouse Perf ≥ 90 / a11y ≥ 95 on home+DAO+profile **+ the heavy live-RPC pages (Marketplace/Validators)** · LCP ≤ 2.5s, CLS ≤ 0.1 · **WCAG 2.1 AA** (today's "AAA" claims are AA work) · axe-clean on 5 routes · Linux+mobile visual baselines · **keyboard-nav + focus-order check · `prefers-reduced-motion` enforced gate · enforced bundle-size budget in CI (today it's only a comment) · error/empty/loading visual coverage on heavy pages.**
1. axe a11y in CI (5 routes). 2. Real visual regression (Linux+390px baselines). 3. Light-theme guard in CI + sweep ~25 hardcoded-color files. 4. `navManifest` enforced SSOT. 5. Decompose the 4 heavy pages; central `queryKeys.ts`. 6. **Badge mint ceremony** (multisig, user-approved) → mount `AchievementGrid` → flip `VITE_ENABLE_BADGES`.

**Gate G3:** AAA bars met in CI; badge loop closed.

### Wave 4 — Reliability & scale for real launch (≈4–6 wk, infra — *not* 2 wk)
> **Council (Delivery seat): honest scoping.** This is a *quarter of platform work*, not a 2-week wave. The SQLite→read-replica/LiteFS migration alone is a project; "load test meets SLOs" presumes SLOs + a harness + alerting that don't exist yet. Sub-phase it: **4a** error reporting + alerting + runbook; **4b** SLO definition + load harness; **4c** the DB durability/HA migration. The marketplace ceremony (Wave 2) is **calendar-bound** (external signers) and can't be compressed by adding engineers.

**Define SLOs first** (e.g. API p99 ≤ 500ms, availability 99.5%, indexer lag ≤ 30 blocks), then build to them. 1. Backend error reporting + alerting to the SLOs + **incident runbook + on-call**. 2. SQLite write-contention plan (read-replica/LiteFS or migration) + fix poller O(supply). 3. HA / deploy-downtime mitigation. **Include a cost line** (object storage, replica, extra Fly machines).

**Gate G4:** load test meets SLOs; alerting + runbook validated; durability/failover drills repeatable.

### Wave 5 — Mainnet (externally gated on gno #5669 / betanet)
On-chain XP settlement (Q-05) · money-realm multisig migration · enable `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1` with golden test · ported realm tests · key rotation · **and the §6 launch-gating answers must be resolved.**

**Gate G5 (mainnet):** betanet live · all money realms multisig · sig-verify enforced · §6 resolved · full sign-off.

---

## 5. Go-live blocker lists (honest)
**Public test13 push:** Marketplace → ✅ **LIVE & SAFE-AS-LIVE** (close the operational tail in Wave 2). Badges → mint ceremony (`TotalSupply` still 0). Services → `escrow_v2` redeploy + fund migration (const `FeeRecipient`/`AdminAddress`). *(Core DAO/token/reviews/quests-XP/validators/member-home/attestation/NFT-marketplace already live.)*
**Mainnet:** gno #5669 + betanet (external) · Wave 1 security · money-realm multisig · sig-verify enforced · §6 resolved.

---

## 6. Launch-gating risks the engineering audit does NOT cover (CEO decision table)

**Reframe (council C7):** the product is **already live** at memba.samourai.app collecting address→behavioral data (XP/reviews) on EU-reachable users, with a `DISCLAIMER` but **no ToS and no Privacy Policy**. So the legal/privacy items are gating **now**, not "before mainnet." This is the cheapest, highest-leverage gap.

**This is the page the CEO decides from.** Each row needs a named owner and a checked box — not more questions.

| Risk | Owner (assign) | Decision needed | Gate it blocks | Recommendation |
|---|---|---|---|---|
| **Legal/regulatory** — token factory + fee-taking marketplace + escrow = possible money-transmission / MiCA / securities exposure | Founder + counsel | Counsel read; entity that collects fees | Loud test13 + mainnet | **Fund now** (counsel retainer) |
| **ToS + Privacy Policy** — live data collection with neither | Founder | Publish ToS + privacy notice | **Live now** (already exposed) | **Fund now** — cheapest item, do this week |
| **Content moderation** — `reviews_v1` + `channels_v2` live & **immutable on-chain**; no abuse-report path, can't delete defamatory/illegal content | Product | Takedown/abuse policy; on-chain hide vs delete | Loud test13 | **Fund now** (live realms) |
| **Token rug/fairness** — tokenfactory has no provenance/honeypot/mint-lock disclosure UI | Product + eng | Provenance UI + risk disclosure | Marketplace launch | **Fund in Wave 2** |
| **Marketplace fraud** — counterparty/wash-trading, fake-collection impersonation (verified-badge is team-curated) | Product + eng | Dispute path; impersonation guard | Marketplace launch | **Fund in Wave 2** |
| **Sybil economics** — addresses are free; per-address limits ≠ sybil-proof; XP→reputation + reviews are sybil targets | Eng | Cost-to-attack analysis; proof-of-personhood? | Mainnet (XP carries weight) | **Accept+document for test13; fund before mainnet** |
| **test13→mainnet data continuity** — migrate / reset / abandon all test13 XP/badges/reviews? | Product | Own product decision **this week** (shapes marketing tone) | Mainnet + marketing | **Decide now** |
| **SLOs + cost** — no SLOs; recurring infra spend (backup/replica/HA) unbudgeted | Eng + Founder | Set SLOs; approve infra budget | Wave 4 | **Fund in Wave 4** |

Detail on the items the eng audit was silent on:

1. **Legal / regulatory.** A **token factory + fee-taking NFT marketplace + services-escrow** plausibly implicates money-transmission / marketplace-operator liability, and (jurisdiction-dependent) MiCA / securities treatment of factory tokens. **Open questions with no owner:** Who is the fee-collecting DAO, legally? Is there a ToS / marketplace-operator agreement? Any KYC/AML obligation on escrow flows? — **Action:** counsel read before mainnet; a ToS before the marketplace takes real fees.
2. **Sybil / abuse economics.** Addresses are free, so **per-address rate limits are necessary but not sufficient.** The XP→leaderboard→reputation→(admin-gated)candidature pipeline, the **web-of-trust reviews** (a textbook sybil target), and **marketplace wash-trading** to farm fees/volume are all unmodeled. **Action:** a sybil-resistance posture (proof-of-personhood signal? stake? cost-to-attack analysis) before XP/reviews carry real weight.
3. **PII / GDPR.** XP ledger + reviews tie pseudonymous addresses to behavioral/reputational data in SQLite. No retention policy, no erasure path, no PII inventory. **Action:** data-handling note; decide retention/erasure before EU exposure.
4. **test13 → mainnet data continuity (the biggest unanswered product question).** What happens to all test13 XP, badges, reviews, candidatures at cutover — migrated, reset, or abandoned? Users who earned Gold on test13: do they keep it? **Action:** make this an explicit, owned product decision *now* — it shapes how loudly you can market test13.
5. **Cost.** Offsite backup, replica/LiteFS, HA machines all carry recurring spend. **Action:** a one-line monthly infra-cost estimate per wave.

---

## 7. What's already genuinely good (don't regress it)
Design-token system (dark+light, **WCAG-AA** contrast) · 45 lazy routes + vendor chunking + PWA w/ RPC-write protection · build-time `assertSafeFlags` gate · a11y primitives (skip-link, focus-trap, `:focus-visible`) · pure-Go SQLite w/ correct WAL/serialized-writer · fault-tolerant home snapshot (per-source, 30s TTL, stale-serve) · subnet rate-limiting w/ correct proxy trust · CI with blocking `dependency-review`/`govulncheck`/`golangci-lint` + the dangerous `deploy-frontend.yml` Action hard-disabled (`if: false`) · clean commits, 0 `@ts-ignore`. **No critical *contract* access-control exploit found; no committed secrets. The substrate is strong — the work is durability, hardening, finish, and the §6 business questions.**

---

## 8. Recommended next 5 actions (this week)
1. **Offsite backup + restore drill** (the one P0) and stop logging the seed.
2. **`STATE.md`-from-`gh` in CI** + re-enable Dependabot + `npm audit fix` reachable highs.
3. **Indexer failover + lag alert.**
4. **Schedule the marketplace multisig deploy ceremony** (the only thing blocking the marketplace) — with the pre-flight checklist + the flag safety-set removal step.
5. **Put §6 in front of the CEO** — pick owners for legal, sybil posture, and the test13→mainnet data decision.

---
## Appendix — severity changes from v1 → v2 (for the record)
| Item | v1 | v2 | Reason |
|---|---|---|---|
| off_chain-XP → candidature | P1 (authz bypass) | **P2** (leaderboard gaming) | Candidature is admin-approval-gated; XP only unlocks the FE button (`QuestProgress.tsx:131`) |
| Ed25519 seed logged | P0 | **P2** | Prod boot-guarded; staging/local only |
| Indexer no-failover | P0 | **P1** | Recoverable (restart/repoint), not data-loss |
| axe unused / visual-reg thin | P0 | **P2** | Quality debt, not launch-blocking/data-loss |
| npm vulns / Dependabot paused | P0 | **P1** | Tier by reachability |
| `MEMBA_ALLOW_UNSIGNED_AUTH` default | P2 | **P1** | One typo from prod auth bypass |
| Multisig sig-verify log-only | P2 | **P1** | Unverified sigs on a money/governance product |
| Single-key money-realm admin | P2 | **P1** | Key-custody risk once lanes hold value |
| Same-volume backups | P0 | **P0 (kept)** | The one genuinely irreversible item |

### v2 → v3 (after council, all chain-verified by the CTO)
| Item | v2 | v3 | Reason |
|---|---|---|---|
| Single-key money-realm admin | P1 | **DROPPED** | On-chain `g1x7k4628…` is a verified 2-of-2 multisig; v2 read a code comment, not the chain |
| market_config admin `g10kw7e55…` | (n/a) | **NEW Wave-2 check** | Returns `null` on-chain (never instantiated) — verify before deploy |
| npm vulns / Dependabot | P1 (8 high) | **P2** | Only 2 prod-reachable (low+moderate); 8 highs are dev-toolchain |
| Light-theme guard "not in CI" | P2 (wire it) | **P2 (corrected)** | Guards already run; gap is inline `style={}` hex → lint rule |
| Healthcheck flap / disk-full / WAL | (missed) | **NEW P1** | Reliability gaps the council surfaced |
| Scoped freeze | "enforceable" | **honor-system today** | Branch protection doesn't require code-owners; Wave-0 task-0 fixes |
| §6 framing | "before mainnet" | **live now** + Decision Table | Product already collecting data with no ToS/Privacy |
| Wave 3 (AAA) | before Wave 4 | **demoted below §6 + reliability** | Gold-plating before launch-gating answers |
| Wave 4 estimate | 2 wk | **4–6 wk, sub-phased** | A quarter of platform work |

*— End v3 (council-reviewed, chain-verified). Council vote: 5/5 SHIP-WITH-CHANGES → changes applied. Awaiting CEO go/no-go.*
