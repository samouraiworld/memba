# Memba — Next-Session Plan (CTO-panel reviewed)

**Date:** 2026-07-24 · **Status:** PROPOSAL awaiting owner review. **Nothing coded, nothing merged this session.**
**Method:** I drafted a plan, then ran **6 fresh adversarial expert sub-agents** (infra/chain, backend/data, gno-core compat, product, release-engineering, red-team) instructed to verify independently rather than trust the draft. They killed or corrected **9 of my claims** and found **2 live production defects** I had missed entirely. Every finding below was re-verified by me directly.

---

## 0. Headline: the two things that actually matter

Both are **live right now**, both were invisible to my draft, and both outrank everything that was in it.

### P0-1 — Topaz users silently lose posts, and merging #999 makes it worse
- `memba_feed_v1` **is** in the topaz `REALM_ALLOWLIST` (`config.ts:325`).
- `FEED_PKG_PATH = MEMBA_DAO.feedPath` (`feed.ts:17`) — **one constant, no network scoping**.
- Feed **reads** come from the backend, which indexes `FEED_RPC_URL` = **test13 only**.
- `FeedComposer` gates on wallet `connected` (`FeedComposer.tsx:77`), **not** on the indexed chain.

⇒ Since #983 (Jul 21), a user who selects Topaz **reads test13's timeline and writes to Topaz's feed realm**. The tx succeeds, costs gas, is permanent on-chain, and **the post never appears anywhere in the product.** Silent data loss on the flagship surface.

**#999 (Phase A) makes topaz logins work → drives more users onto topaz → amplifies this bug.** So the claim "Phase A is additive, zero regression" — in my draft, in #999's body, and in the cutover doc — **is false.**

**Fix (~1 day, no owner gate):** gate the feed write path on the indexed network, with a "the feed is indexed on Testnet 13 — [Switch]" affordance. **Prerequisite to #999, not a follow-up.**

### P0-2 — The published moderation policy promises a capability that does not exist
Shipped yesterday by C.5 (#1000), public at `/feed/transparency`:
- `MODERATION_POLICY.md:38-39` — *"erasure additionally scrubs the projection so a rebuild cannot resurface it."* **There is no erase action.** `feed_moderation.go` supports exactly `block` / `unblock` / `override_serve` / `clear_override`.
- `:44` — operators *"can **sweep** old tombstones — permanently purging them on-chain."* **`Dockerfile:13` builds only `./cmd/memba`** — `activitybot` (which holds the sweep) **is not in the production image**. It cannot run.
- *"Appeals & contact"* names **no contact channel**.

This is a live, public, false claim about GDPR erasure — precisely the overclaiming failure the feed plan's own §7.4 exists to prevent.

**Fix (~30 min, no owner gate):** amend the policy to describe what exists, add a real contact. **Do this first, regardless of everything else.** It also reframes C′.1: that work isn't "next in the queue," it's how you earn back a claim you're already making.

---

## 1. Corrections to my draft (all verified)

| My draft claimed | Verified reality |
|---|---|
| test13 RPC **frozen 23h** | **2-node load-balanced pool** — 20 probes: 10× h=1013913, 10× h=999584, *both advancing*. Real defect = **non-monotonic reads across a ~14.3k-block gap**. My 2-probe method couldn't distinguish the two. |
| #999 "fully green, ready" | Green **but `BEHIND`** — CI ran against a 5-commit-old main. **All 7 open PRs are BEHIND.** `enforce_admins:false`, so `--admin` bypasses required checks, strict, approval and conversation-resolution *simultaneously*. |
| C′.3 = open 1-line bug | **Already shipped** (#957, `feed_tailer.go:277`). Phantom item. |
| "6 weeks of upstream unreviewed" | **9 days** (Jul 11 → Jul 20). Contradicted my own §0 table. |
| grc20 attr parsing "unverified" | **Answered: NO.** Dispatcher keys on `ev.Type` only; `token` is not among the 23 attr keys the indexer reads. Realm templates *already migrated* (samcrew-deployer#123, 2026-07-18). §3 collapses. |
| `Token.ID()` → `<realmpath>.<localID>` | **`<realmpath>.<symbol>.<seqid>`** — symbol is *retained*. I copied the upstream PR prose, which contradicts its own code (`token.gno:52`). Prefix-matching consumers are unaffected; grc20reg's key is unchanged. |
| "#5945 open → topaz not finalized" | **Irrelevant.** topaz-1 runs branch **`chain/topaz@fc4052651`**, which is **not an ancestor of master**. Merging #5945 cannot change a running chain. |
| §1.a staleness-failover first | **Can't work against a pool** (per-URL health, per-request backend). The configured fallback (**onbloc, h=1017373, healthy**) is already correct — the fix is a one-line primary swap. Priority was inverted. |
| C′.1 then C′.4 | **Backwards.** C′.1 mutates the immutable raw ledger via a forward-only migration (**0 down-files**) on a single-machine volume — the only irreversible item in the plan. Build the verifier (C′.4) first. |
| EVM collision risk = indexer | Indexer, `config.ts`, `rpcFallback.ts` **untouched**. Real overlap = **`frontend/package.json` + `package-lock.json`** → risk is the *dependabot* batch. |
| `networks.toml` stale note | Phantom — wrong repo (samcrew-deployer), and already fixed. |

**Also unsupported:** I framed the degraded endpoint as evidence that "test13 infra is degrading → accelerate the cutover." Upstream still lists test13 as the **current active testnet**, the Topaz release PR **#5945 is still open**, and there is **no deprecation notice**. That inference was motivated reasoning; I've dropped it.

---

## 2. Topaz cutover — corrected

**The root cause is not `FEED_START_BLOCK`.** Two experts converged independently:

> `feed_indexer_state`, `nft_indexer_state` and `feed_raw_events` have **no `chain_id`** — breaking a pattern `001_initial.sql:12` already established. `memba_feed_v1` is the *same path* on both chains, and `feed_raw_events` is keyed `(event_block, tx_index, index)`, so **topaz block N collides with test13 block N.**

**⇒ Migration 028 (add `chain_id`) replaces the entire destructive reset.** New chain → no cursor row → clean scan; test13 projection sits inert; rollback is a pure env flip. It dissolves four separate hazards at once.

**Three blockers in the cutover doc as written (`MEMBA_TOPAZ_DEFAULT_CUTOVER_PLAN_2026-07-24.md`, referenced by #997):**

1. **"Fresh Fly volume" does not give a clean slate — and threatens the only backup.** `start.sh:30-32` runs `litestream restore -if-replica-exists` when no DB is found → **silently restores the test13 DB**. `litestream.yml` has one fixed prefix `memba`, `retention: 168h`; re-replicating topaz into it ages out the test13 restore point in 7 days. `OPS_RUNBOOK.md:249`: *"This is the ONLY backup mechanism."*
2. **`DELETE FROM feed_blocklist` is forbidden by design.** `021_feed_blocklist.sql:1-11` states it must survive rebuild — it's the illegal-content takedown record with no other durable copy. The doc's rationale is also backwards: a fresh realm restarts post ids at **1**, so stale ids *do* collide. A stale `feed_serving_overrides` row would **force-serve** a flag-hidden topaz post — a safety inversion. Delete *and* keep are both unsafe; chain-scoping is the answer.
3. **`FEED_START_BLOCK=0` is a no-op that re-arms the bug.** `feed_tailer.go:41-43`: `if cfg.StartBlock <= 0 { cfg.StartBlock = 260000 }`. The doc recommends `0`. Use `1`, or fix the sentinel.

**Also:** the doc **contradicts itself** on `NFT_RPC_URL` (line 37 says move it to topaz; line 46 says leave it) — and `NFT_RPC_URL` is the silent fallback for the feed tailer, home snapshot, **quest verification**, marketplace proxy and token launches. Leaving it pinned makes **every topaz quest claim fail**.

**Timing note:** topaz is at ~158k and rises ~1 block/5s. It passes `260000` in **~6 days**, at which point the failure changes from *loud* (WARN loop) to **silent** (tailer starts at 260000 and skips all history). The window for a noisy failure is closing.

### 2b. Gno-core: the real item is a stale CI pin (not a sweep)

The sweep I proposed was mis-sized: both headline items were **already actioned in samcrew-deployer#123 on 2026-07-18**, six days before I wrote the draft. The genuinely unactioned item was in neither my draft nor the sweep doc:

- **`Memba/.github/workflows/gno-test.yml:49` — `GNO_PIN = 7b2888c3b` (2026-07-01), 51 commits behind master and older than Topaz's own gno.** That job is the **only** compile gate on the client templates users deploy via `/vm.m_addpkg` (`daoTemplate.ts`, `agentTemplate.ts`, …). It type-checks them against a chain nobody runs. **Bump to `fc4052651` (matching the deployer's `GNO_REF`) and re-run the compile gate — sequence this BEFORE Phase B**, since Phase B makes topaz the default network for exactly those templates. (S)

**New constraint for Phase A/B — a hard flag-day split.** grc20's `NewToken` signature differs between the two chains (live-probed via `vm/qfile`): test13 `NewToken(_ int, rlm, name, symbol, decimals)` vs topaz `NewToken(name, symbol, decimals, id seqid.ID, rlm)`. Since `tokenfactory_v2.gno:110` is already migrated, **that realm can now only deploy to topaz — a test13 re-deploy would fail to compile.**

**Gas, from #5892 (`PreprocessGasPerByte` × every prod `.gno` byte):** mid-size realms now carry a ~48–52 M preprocess floor *before any work*. `networks.toml` betanet/portal-loop `gas_wanted = 80 M` → 65 % consumed; **`local = 10 M` → mid-size realms are un-deployable locally.** And `frontend/src/lib/gasConfig.ts` `deployWanted = 50 M` vs ~27.7 M for the DAO template (55 %) — with the base **user-editable in localStorage**, so anyone who lowered it gets a guaranteed out-of-gas on every DAO deploy once topaz is default. **Floor `deployWanted` independently of the user setting.** *(Ceremony funding is unaffected — the 385.7 GNOT figure was already measured on a post-#5892 chain.)*

**Sweep-doc integrity bug:** 7 SHAs cited in the 2026-07-03 sweep are **not ancestors of master** (rebased away, re-landed squashed). That produced a real mis-call — `084554b8b` was filed "transparent to realm code," but its re-landed form (#5892) raises deploy gas and changes the app hash. Cite PR numbers, not SHAs, and verify with `merge-base --is-ancestor` before trusting any prior assessment.

**Commerce-dark is not binary.** The nav gates on flags only — grep for `isRealmValid` in `navManifest.ts` = **0 hits**. A topaz user clicking Marketplace/Tokens gets errors, not a gate. But the middle path is ~90% built: network is a URL segment (`App.tsx:223`), `switchNetwork()` preserves the path (`useNetwork.ts:27`), and `RealmsNotDeployedBanner.tsx:44` is the copy precedent. **A per-feature "this lives on Testnet 13 → [Switch]" gate (~1 day) dissolves the owner's dilemma.**

**Phase B's blast radius is inverted:** `getActiveNetworkKey()` reads `localStorage` first, so flipping the default moves **only new visitors** — degrading exactly the first-impression path while converted users keep commerce.

---

## 3. Merge gate — hardened (my §7 was not safe)

**The hole:** I wrote "excludes anything that auto-deploys prod **(#999)**". That reads as an enumeration; it is a **class**, and the class is large.

- `deploy-backend.yml` triggers on **`paths: ['backend/**']`** → **any** backend merge deploys prod.
- Migrations **auto-apply at boot** (`main.go:123 db.Migrate`, `//go:embed migrations/*.sql`), **forward-only, zero down-files**, single machine + volume.
- **This includes dependabot #977** (`backend/go.mod`).

⇒ Under my draft's wording, three §4 items and a dependabot bump were "autonomous."

**Additional false-green modes found:** `gh pr checks` exit 0 ≠ required checks passed (missing ≠ failing; `skipping`/`cancelled` read as non-failing); the rollup is keyed to head SHA; the **double "Changelog entry"** on #999 is one gate re-run after the `no-changelog` label — naive parsing gives a false RED *or* a false GREEN.

**Netlify trap (hits #997 directly):** `netlify.toml` sets `base="frontend"` with **no `ignore`** → a **root-file-only change merges green and never ships**, then applies silently on some later unrelated frontend merge. **#997 changes exactly `netlify.toml` + `config.ts`.**

**Hardened gate — must ALL hold:**
1. `mergeStateStatus == CLEAN` (not merely `MERGEABLE`) — else `update-branch`, re-pin SHA, wait for a *fresh* run.
2. Pin `headRefOid`; merge with `--match-head-commit <SHA>`.
3. All **7 required checks present AND `bucket == pass`** — never "no failures". Verify via `gh pr checks --required --json name,bucket`, never raw `statusCheckRollup`.
4. Zero non-required checks failing (`UNSTABLE` absent).
5. Zero unresolved review threads.
6. Second-lens review recorded **as a PR comment** — this substitutes for the approval `--admin` bypasses.
7. Pre-merge collision fingerprint diff (remote refs, occupied-checkout HEAD/dirty/index-lock, worktrees, PR head SHAs, in-flight runs) — abort on any drift.
8. **No other open PR touches the same file.**
9. One merge in flight at a time; verify the resulting deploy before the next.
10. Zero Claude attribution.

**NEVER autonomous:** anything under `backend/**` · any migration · `backend/fly.toml` · `.github/workflows/**` · root `netlify.toml` · `config.ts` network defaults/RPC ordering · any `VITE_ENABLE_*` → `true` or `SAFETY_GATED_FLAGS` removal · edge functions · breaking proto · realm/on-chain deploys · secrets · anything the EVM branch touches.

**That leaves genuinely autonomous:** frontend-only non-flag non-config PRs, docs/planning PRs, and **frontend** dependabot (#978/#979/#980/#987 — *not* #977).

**Operational traps:** local `main` ref is stale at `7577b616` → always `worktree add -b <br> <path> origin/main`, never `main`. Review via `gh pr diff` / `git show origin/main:<path>`, never the occupied working tree (it lacks migration 027 and all of C.4–C.7). The commit hook is blind to detached HEAD, to `git -C "$VAR"`, and to **`git push` entirely** — nothing stops `push origin br:main`. Branch `develop` is configured to push to `main`; never check it out.

---

## 4. Recommended sequence

**Do first (no owner gate, high value):**
1. **Truth-up `MODERATION_POLICY.md` + add a contact** (~30 min) — removes a live false public claim. *(P0-2)*
2. **`FEED_MODERATION_RUNBOOK.md`** — real action names (**`override_serve`**, not the plan's `serve_override` — curling the plan text returns 400), the block/unblock drill, and the **`FeedGate` coupling**: `/feed/mod` *and* `/feed/transparency` are both inside `<FeedGate>`, so the documented rollback "flip `VITE_ENABLE_FEED` off" **kills the moderation console and the transparency page at the exact moment you need them.** Closes 2 growth-gate items. (~2h)
3. **Link `/feed/transparency` from the feed header** — currently reachable only by typing the URL. (1 line)
4. **Topaz feed write-gate** *(P0-1)* — must precede #999. (~1 day)
5. **RPC: one-line primary/fallback swap** to the healthy node + delete `ChainHaltedBanner`'s hardcoded `test13` exemption (`ChainHaltedBanner.tsx:58`) so users are *told*. **Coordinate with #997 — same file.** (~2h)

**Then (owner-gated or lower urgency):**
5b. **Bump `GNO_PIN` → `fc4052651`** + re-run the template compile gate (§2b). Gates Phase B. (S)
6. Migration 028 `chain_id` scoping — converts Phase B from irreversible to additive.
7. C′.4 `cmd/feedrebuild` — **before** C′.1.
8. C′.1 erasure — as `UPDATE`-in-place + a persistent `feed_erasures` denylist, **not `DELETE`** (a `DELETE` is undone by replay, since inserts are `INSERT OR IGNORE`). Flag **IRREVERSIBLE**; snapshot first.
9. Frontend dependabot batch (expect `package-lock.json` conflicts with the EVM branch → `@dependabot recreate`).

**Cut from my draft:** C′.3 (shipped), §5.c (phantom), the gno-core *sweep* (→ a doc entry recording deployer#123; the only real code work is the `GNO_PIN` bump, now item 5b), C′.2 (no urgency), the Phase B rehearsal (gated on a decision not yet made — and against topaz's **empty** feed it would prove only "the cursor advances," not that events decode; it needs a seeded post to be worth anything).

**Realistic capacity: 2–3 items, not 7.**

---

## 5. Owner decisions — one consolidated ask

1. **Merge-target ambiguity.** You said "merge PRs autonomously **on a dedicated branch**." I've assumed: work on feature branches, merge to `main` under §3's gate, nothing that auto-deploys prod. **If you meant merge into a dedicated integration branch instead of `main`, say so — it changes everything.**
2. **Growth gate is 2/8 green, not closed.** Remaining: bearer **drill** (not just set), sweep actually deployed (activitybot isn't in the image), the gnomonitoring alert (VPS-only, rule in #1002's body), documented rollback. Wave C shipped the *code*; these close the gate.
3. **Gno lane vs EVM lane.** `docs/evm-migration/PROGRESS.md` records a **founder GO decision dated today (2026-07-24)**. Phase B migrates Gno-testnet→Gno-testnet; Wave D is a one-shot immutable **Gno** realm pour. *(Reported as observed in your working tree — please confirm; I did not touch that branch.)* This should gate #6/#7 above.
4. **Commerce-dark** — recommend building the cross-network gate (§2) so it stops being binary, rather than answering it as posed.
5. **#999** — hold until P0-1 ships.

---

## 6. Reality check the plan was missing

The feed has **4 live posts**, newest **2026-07-15**, and the Jul-20 ICO wave produced **zero**. Wave C spent 7 PRs on a moderation stack for 4 test posts and no abuse; C′ proposes data-integrity machinery for a 4-row table. The binding constraint is **supply**, which the feed plan's own §6.3 already says — and the supply loop (Wave F.3 share-to-feed, realm-free, no owner gate) is in neither my draft nor the queue.

**If the goal is a living feed, F.3 beats all of C′.**

---

## 7. Repo state (verified)

- `origin/main` = `d41848e3`. All 26 repos fetched; 24 current.
- **Untouched:** the Memba checkout (parallel EVM session, `feat/evm/foundation`, uncommitted).
- **Needs your call:** `gno-agent-workspace` and `gno-docs` are duplicate clones of the same repo, diverged since 2026-04-07 — **392 unpushed local review commits vs 443 remote**. Real work both sides; I did not resolve it.
- topaz-1 multisig unchanged (`9614294200ugnot`, seq 24) → nothing deployed since the ceremony; the `REALM=` funding blocker stands, so "just deploy commerce to topaz" is **not** available.
