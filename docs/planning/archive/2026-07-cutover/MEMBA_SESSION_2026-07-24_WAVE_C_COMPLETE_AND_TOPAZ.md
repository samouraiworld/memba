# Session 2026-07-24 — Feed v2 Wave C completed + Topaz cutover staged

**Outcome:** Feed v2 **Wave C is DONE** (C.2, C.4, C.5, C.6, C.7 all merged; C.1/C.3 shipped previously).
`origin/main`: `89187ef9` → **`d41848e3`**. Topaz-as-default is **staged, owner-gated** (2 PRs open).

---

## 1. What was asked

1. Pull the Gno repos; read the Memba docs/state; **verify, don't trust** prior docs/plans (they were written with a low-quality model).
2. Continue **Feed v2 Wave C.2**, but run a **cross-perspective expert design review before writing code** (independent lenses, synthesize first).
3. Note: test13 is being shut down; **Topaz should become the default**, test13 hidden/deleted.
4. Then: open the Phase-A PR, continue Phase B, and do **C.5/C.6/C.7 autonomously**; verify, update, clean, close.

Autonomy: merge under a strict gate (deep-reviewed + CTO-lens + tests + up-to-date + CI green **verified** + peer-reviewed), never commit to main, zero Claude attribution, always check for parallel sessions.

---

## 2. The most consequential result: the C.2 design review changed the design

The Jul-13 plan's C.2 row specified **"quarantine-vs-tombstone"**: serve *every* flag-auto-hidden post's body to the anonymous public behind a click-through "view anyway" veil, gated on `VITE_ENABLE_FEED`.

Four **independent** expert lenses (same verified ground truth, no shared conclusions) converged against it:

| Lens | Verdict | Core finding |
|---|---|---|
| Security/privacy | **UNSAFE** | `PostAutoHidden` fires automatically at the crowd-flag threshold **before any human review**, and that set is enriched for illegal content. Default-serving it behind a veil makes un-reviewed illegal content *more* accessible than today's exclusion. The plan's "illegal never quarantines" rule is a **manual takedown racing an automatic, instant exposure it cannot win**. |
| API/ops | NEEDS-CHANGES | `VITE_ENABLE_FEED` is a **frontend build flag and cannot gate a backend serving change** — the backend serves the OG crawler + direct RPC callers regardless, so bodies would hit the public wire ungated. Also: the OG edge function keys `isTombstone` on the `hidden` bit — clearing it to render a veil would leak moderated bodies into permanent third-party unfurl caches. |
| UX/product | SHIP-REDUCED | At current scale flag-hidden ≈ spam/abuse, not brigaded-legit speech; a blanket "view anyway" mis-applies the contested-speech pattern and invites clicking through exactly what flags meant to suppress. The transparency win comes from C.5's public log, not a per-post reveal button. |
| Data-integrity | NEEDS-CHANGES | **`hidden_cause` is a tautology** (`hidden=1 AND deleted=0` already ⟺ flag-caused in the deployed realm) and a **rebuild-from-raw divergence trap**. Relaxing `hidden=0` also silently filesorts the home timeline. `reply_count` semantics must be pinned. |

**Decision (owner-approved): ship (A) the operator lever only; defer (B) the public veil.**
The result — the **serve-override** — delivers the actual stated goal ("a brigade is reversible without a multisig ceremony") while nothing un-reviewed is ever auto-served: security guardrail *G1 (human-gated, fail-closed)* holds **by construction**.

---

## 3. Shipped (all gated-merged, no attribution)

| Wave | PR | Merge | Summary |
|---|---|---|---|
| **C.2** serve-override lever | [#996](https://github.com/samouraiworld/memba/pull/996) | `7577b616` | Migration **026** `feed_serving_overrides` (out-of-band, mirrors `feed_blocklist`; survives rebuild + reorg) + `idx_feed_posts_served` (no filesort). Bearer `override_serve`/`clear_override`. Total precedence: **blocklist > deleted > serve-override > flag-hidden > live**. Public reads return *effective* hidden → a restored post renders normally. **No proto, no frontend, no `hidden_cause`.** |
| **C.4** moderation console | [#998](https://github.com/samouraiworld/memba/pull/998) | `89187ef9` | `/:network/feed/mod` behind `VITE_ENABLE_FEED`. Flagged queue renders **bodies** (deliberately *not* PostCard's tombstone) + block/unblock/override/clear actions; public body-free audit log. Bearer is operator-pasted, **sessionStorage-only**, per-call header, auth errors surface. |
| **C.5** transparency + policy | [#1000](https://github.com/samouraiworld/memba/pull/1000) | `94d5983e` | Public `/:network/feed/transparency` (policy summary + live body-free log) + tracked `docs/MODERATION_POLICY.md`. `FeedModAuditLog` gained `hideFlagger`: the public page masks community-flaggers (text **and** `title`); moderators stay accountable; the C.4 console still shows flaggers for brigade review. |
| **C.6** sweep cron | [#1001](https://github.com/samouraiworld/memba/pull/1001) | `59ec2b44` | activitybot `sweep` action → `SweepTombstones(limit 1..10)`. **Dry-run by default**, **not value-moving** (never spends the transfer budget), gnokey key-by-name. Runbook documents the paused-realm caveat. |
| **C.7** abuse metrics | [#1002](https://github.com/samouraiworld/memba/pull/1002) | `d41848e3` | Four gauges on the existing **METRICS_BEARER-gated** `/metrics`: `memba_feed_flags_per_hour`, `unique_flaggers_per_day`, `auto_hides_per_day`, `posting_authors_per_hour`. Migration **027** indexes `feed_raw_events(event_name, ingest_ts)` **and** `feed_posts(deleted, block_ts)`. Low unique-flaggers + high flags/hour = the brigade signal. |

---

## 4. Topaz-as-default — verified, staged, owner-gated

**Verified live (not from docs):** test13 and topaz-1 RPCs are **both up** — the shutdown is planned, not done. Making Topaz the default is a **coordinated frontend + backend change**, not a one-liner:

- Backend `MEMBA_ACCEPTED_CHAIN_IDS='test-13'` would **reject every topaz-1 login** (`ValidateToken`).
- The feed/NFT indexers **tail test13** (`FEED_RPC_URL`→`NFT_RPC_URL`).
- topaz's realm allowlist has **no commerce realms** → commerce goes **dark**; topaz's feed realm is **empty** (live `qrender`: "Live posts: 0").
- `SNAPSHOT_NETWORK` is hardcoded `test13`; the home snapshot reads `tokenfactory_v2` (absent on topaz → degrades to `staleSources`).

### ⛔ The de-risk finding (was the highest-risk unknown; now CONFIRMED)
`feed_indexer_state` / `nft_indexer_state` are keyed by **`realm_path` — chain-agnostic**. `memba_feed_v1` is the *same path* on both chains, so after re-pointing the RPC, `loadFeedCursor` returns **test13's high block height** on topaz (a fresh, far-shorter chain) → `feedTailOnce` finds no blocks above the cursor → **the tailer idles forever and topaz never indexes.** Compounding: `FEED_START_BLOCK` defaults to `260000` (a test13-era value). **A naive env-only flip bricks the feed indexer.**

**Required for Phase B:** set `FEED_START_BLOCK` ≤ topaz height, **reset the cursor + wipe the test13 projection** (`feed_indexer_state`, `feed_posts`, `feed_raw_events`, `feed_flags`, `feed_reactions`, `feed_blocklist`, `feed_serving_overrides`) against a **fresh Fly volume** (keep the test13 volume for instant rollback). Don't switch the NFT indexer (no commerce realms on topaz).

### Phasing
- **Phase A (recommended first, zero regression):** PR **[#999](https://github.com/samouraiworld/memba/pull/999)** — `MEMBA_ACCEPTED_CHAIN_IDS='test-13,topaz-1'` (verified comma-split). Topaz becomes usable *on selection* (auth + all on-chain realm features). Feed/home stay backend-global (test13) — pre-existing behavior, not a regression.
- **Phase B (held):** PR **[#997](https://github.com/samouraiworld/memba/pull/997)** (draft) — flips `netlify.toml VITE_GNO_CHAIN_ID` to topaz. Deliberately minimal: the code fallback and `SNAPSHOT_NETWORK` stay `test13` (flipping the fallback would change the *test* default and cascade a suite-wide break for no prod benefit).
- Full plan: `docs/planning/MEMBA_TOPAZ_DEFAULT_CUTOVER_PLAN_2026-07-24.md`.

---

## 5. What the review process caught (it kept paying for itself)

- **C.4 — a real blocking bug I shipped:** `post_id` sent as a JSON **string**, but the backend decodes `uint64` with no `,string` tag → **every moderation action would have 400'd**. Both test suites were green *because the frontend mocks `fetch`*, so nothing crossed the real Go decoder. **Lesson: a frontend unit test that mocks `fetch` does not verify the wire contract.**
- **C.2 — the design itself** (see §2).
- **C.7** — `posting_authors_per_hour` full-scanned `feed_posts` every scrape → added the `(deleted, block_ts)` index.
- **C.5** — the policy doc stated the sweep as an operating guarantee before it existed, and used a non-canonical `serve_override` token → corrected; flagger-mask test hardened against a `title`-attribute leak.

## 6. Gotchas learned (worth remembering)

- **`gh pr checks --watch` exit 0 is NOT trustworthy after a force-push** — it raced the new run and reported a stale green while 2 checks were failing. **Always re-verify the final bucket state on the current HEAD sha before merging.**
- **CI §13 gate:** `ci.yml` fails on any hardcoded `color: #hex` in `src/**/*.css` (light-theme contrast) — use `--color-k-*-text` tokens. `background:`/`border:`/`var()` fallbacks are exempt.
- **gopls reports false "undefined" errors for files in a git worktree** (not in the go workspace) — `go build`/`go test` are the truth.
- **Never run a modifying git command in the shared main checkout without checking its current branch first** — a parallel session had moved it off `main` (my `--ff-only` aborted harmlessly, but that was luck).
- `no-changelog` is legitimate for operator-only/infra changes (precedent: C.3, C.4, C.6, C.7).

---

## 7. Open items (owner-only — I cannot do these)

1. **Merge [#999](https://github.com/samouraiworld/memba/pull/999)** → Phase A go-live (merging auto-deploys the backend via `deploy-backend.yml`). Verify: `flyctl logs -a memba-backend` shows `accepted_chain_ids=[test-13 topaz-1]`, then log in on Topaz.
2. **C.7 alert — VPS-only.** gnomonitoring has no Prometheus/Alertmanager in-repo (its alerting is validator-hardwired). Apply on the VPS stack: a bearer scrape job for `memba-backend.fly.dev/metrics` + the `MembaFeedFlagSpike` rule (both in #1002's body).
3. **Phase B decision** — commerce-dark go/no-go + the mandatory indexer reset, then merge #997.
4. Pre-existing, orthogonal: `GetModerationLog` still emits flagger addresses over the wire (the C.5 page masks them at display only) — worth a backend aggregate-only change someday.

## 8. State at close

- `origin/main` = **`d41848e3`**; all five PRs merged; **no Claude/Anthropic attribution** in any commit (verified).
- Open PRs: **#999** (Phase A, owner) and **#997** (Phase B, held draft). No stray PRs.
- **All session worktrees and feature branches removed**; `Memba-worktrees/` is empty.
- ⚠️ The Memba **main checkout is on `feat/evm/foundation`** (`8b61b141`) — a concurrent `zxxma` session's Chain-Abstraction-Layer work, with uncommitted `.gitignore` WIP. **Left entirely untouched**; all work here went through isolated worktrees + the remote. Run `git checkout main` there once that session wraps.
- Memory updated: `project_memba_feed_c2_serve_override_2026_07_24.md` + `MEMORY.md` index.
