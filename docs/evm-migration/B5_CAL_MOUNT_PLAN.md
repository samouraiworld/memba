# B-5 — Mounting the Chain Abstraction Layer: migration plan

> **Status: APPROVED 2026-07-25** — owner took recommendations on all four decision points
> (D1 UnifiedMarketplace NFT path first; D2 ≥1-week soak + zero CAL-attributed Sentry
> events before money paths; D3 `VITE_ENABLE_CAL` in `SAFETY_GATED_FLAGS` until Phase 3
> completes; D4 Path B revisited after Phase 3).
>
> **Phase 0: ✅ DONE 2026-07-25** — G1 `setWalletBridge` (typed, replaces the uncalled
> cast-attached `setWalletState` vestige; 10 write/bridge tests incl. vote-string mapping
> and addMember power/roles threading), G2 network-scoped username cache/registry
> (`registryContextFor`; unknown endpoints never cached; 5 tests). App behavior unchanged —
> CAL still unmounted.
>
> **Phase 1: ✅ DONE 2026-07-25** — `ChainContextProvider` mounts in `main.tsx` behind
> `VITE_ENABLE_CAL` (SAFETY_GATED per D3; deploy-previews exempt = the flag-on validation
> surface). Wallet bridge wired (useAdena → `setWalletBridge`). EVM factory registration is
> now LAZY (dynamic `EvmProvider` import; interim factory throws until the chunk loads —
> unreachable, EVM networks are hidden till Phase 4). viem rides the async `vendor-evm`
> chunk: manualChunks + Workbox precache-exclusion + a new CI gate
> (`scripts/check-evm-chunk.mjs`, wired into `check:bundle`) mirror the vendor-three cost
> firewall. The gate caught a real leak on its first run: Rollup colocated Vite's shared
> preload-helper into vendor-evm, statically coupling EVERY chunk to viem — fixed by pinning
> the helper to its own chunk. **Flag-off build: the entire CAL graph is dead-code-eliminated
> (zero bytes shipped; vendor-evm emitted as an unreferenced, precache-excluded orphan).**
> Flag-on preview verified in-browser: clean boot with zero console errors, vendor-evm lazily
> fetched, test13→topaz→test13 network switch reloads correctly per the B-3 contract.
> 4 provider tests added (bridge sync, active-network seeding). Next: Phase 2 (first page —
> UnifiedMarketplace NFT path, per D1).
>
> Every phase below is separately shippable and separately revertable. Written 2026-07-25,
> after B-3 (network-model reconciliation), B-4 (real per-network endpoints) and B-6
> (first provider tests) landed.
>
> Companion records: BACKLOG B-1/B-2/B-5, KNOWN_ISSUES (pre-B-5 landmine), ADR log.

## 0. Where we actually are

**Done and load-bearing for this plan:**
- B-3: the CAL adopts `memba_network` + the reload-on-switch contract (`lib/networkSwitch`),
  its Gno networks derive from `config.NETWORKS`, and `assertWalletBroadcastSafe` stays
  correct across a mount. Mounting no longer breaks Gno broadcasts.
- B-4: `config.rpcUrl` is real — a provider built for network X actually reads network X
  (direct lane, no cross-network failover, no failover-memo poisoning).
- B-6: provider behavior is pinned by tests (rpcUrl threading, vote enums, status
  derivation), so migration regressions surface in CI, not in prod.

**Blocking gaps found during B-4/B-6 (must close before or during Phase 1):**
- **G1 — GnoProvider has no wallet injection path.** `_walletAddress` is factory-local and
  nothing sets it; every CAL write throws `WALLET_NOT_CONNECTED`
  (`GnoProvider.test.ts` pins this). EvmProvider has `setWalletClient`; GnoProvider needs
  the equivalent bridge from `useAdena`'s state.
- **G2 — username-cache poisoning (KNOWN_ISSUES).** `dao/shared.resolveUsernames` caches
  under the ACTIVE network's key and queries the active registry constant. A cross-network
  CAL read would poison it. Fix: key cache + registry path by the queried network.
- **G3 — C-5:** half of GnoProvider's token/escrow surface silently returns "no data"
  rather than "unsupported". Any page migrated in Phase 3 that touches those methods needs
  them implemented (or made loudly unsupported) first.
- **G4 — auth (B-1/B-2):** EVM login is blind `personal_sign`, no SIWE, and the `Verifier`
  interface can't express challenge semantics. Not needed to mount the CAL for GNO pages;
  HARD-blocks exposing any EVM network in the selector to real users.

## 1. Principles

1. **Gno behavior is the hostage — release it last.** Every phase keeps the existing
   `useAdena`/direct-lib path byte-identical until a page is deliberately migrated.
2. **One flag, one kill switch.** `VITE_ENABLE_CAL` (default **off**, `assertSafeFlags`-listed
   like other safety-gated flags) gates the provider mount AND every migrated call site via
   one predicate. Rollback = flag off = pre-CAL code paths run. No dual maintenance beyond
   the migration window.
3. **EVM networks stay invisible** (`NetworkSelector` filters `family === "evm"`) until G4
   closes and contracts are actually deployed (DEPLOY_CEREMONY + F-1 ArbOS check).
4. **No silent scope growth.** Anything discovered mid-migration lands in BACKLOG, per the
   standing rule.

## 2. Phases

### Phase 0 — prerequisites (no UI change)
- G1: add `setWalletBridge(state)` (or subscribe to the `useAdena` store) to GnoProvider;
  replace the B-6 dead-end pins with real write tests (vote "yes"→"YES", addMember
  power/roles threading — the exact regressions the current code comments as fixed).
- G2: network-key the username cache + registry path.
- Extend CAL tests to the bridge (connected wallet → broadcast path builds the right msgs).
- **Gate:** all existing tests + new bridge tests green; app behavior unchanged (flag off,
  provider still unmounted).

### Phase 1 — mount, inert
- Mount `ChainContextProvider` in `main.tsx` behind `VITE_ENABLE_CAL`. Zero consumers.
- **Gate:** with the flag ON in a preview build: boot, login, broadcast, network-switch all
  behave identically (the B-3 e2e surface); bundle delta ~0 (provider factories are small;
  viem must stay OUT of the eager graph — EvmProvider should become a lazy import if it
  drags viem in; verify with the existing bundle gates).
- **Rollback:** flag off (or unmount — one line).

### Phase 2 — first page end-to-end (the plan's Phase-V validation)
- **Prerequisite (found by the Phase-1 adversarial review):** the root
  `ChainContextProvider`'s useAdena instance never cross-syncs with other instances —
  it misses interactive connects (until a `visibilitychange` retry) and never sees
  disconnects, so the wallet bridge can go stale. Before any page relies on CAL
  *writes*, hoist a shared wallet source (single useAdena at the root feeding both the
  bridge and the app, or a subscribable store). Reads are unaffected.
- **Recommended first page: `UnifiedMarketplace`'s NFT read path** (or its smallest
  self-contained subview). Rationale: it exercises the grc721 read seam B-4 just made
  per-network (highest verification value), it is read-heavy with ONE bounded write
  (approval), and it is not on the money-critical feed/escrow path. Alternative if a
  read-only start is preferred: `LegacyCollectionView` (tiny, already tested, zero writes) —
  lower risk, but proves much less.
- Wire the page's reads through `useChain()`; keep writes on `useAdena` in this phase if the
  Phase 0 bridge review surfaces any doubt.
- **Gate:** page-level tests (mock provider), e2e against test13 with flag on/off parity,
  no console/feed regressions.
- **Rollback:** flag off restores the direct-lib path.

### Phase 3 — migrate the ~25 remaining `useAdena` files in waves
Wave order (blast-radius ascending, each wave = one PR, same gates as Phase 2):
1. Read-mostly pages: Leaderboard, QuestHub, QuestDetail, Directory views.
2. Social writes: FeedPage/FeedThread/FeedProfile (respect the feed write-gate work, #1004),
   AppStore pages (AppSubmit/AppCurator/PublisherConsole).
3. Money paths LAST: marketplace trade modals, escrow, OTC — only after waves 1–2 have
   soaked in prod for an agreed window.
- After the last wave: delete the direct `useAdena` imports from pages (the hook itself
  stays — it IS the Gno wallet), collapse the flag, un-gate.

### Phase 4 — (separate program, out of B-5 scope) EVM exposure
G4/auth (B-1/B-2 → SIWE via viem), contract deployment + ceremony, indexer/backends
(A-7b allowlist, G-4 module split), THEN un-hide EVM networks. Listed only so nobody
mistakes "CAL mounted" for "EVM ready".

## 3. Owner decision points (please rule on these at review)

| # | Decision | Recommendation |
|---|---|---|
| D1 | First page: `UnifiedMarketplace` NFT path vs `LegacyCollectionView` | UnifiedMarketplace — proves the seams that matter |
| D2 | Phase-3 wave 3 soak window before money paths migrate | ≥1 week prod soak, zero CAL-attributed Sentry events |
| D3 | Flag name/handling: `VITE_ENABLE_CAL` in `SAFETY_GATED_FLAGS` (prod build fails if "true") until Phase 3 completes? | Yes — same discipline as the other gated flags |
| D4 | Path B (observable network store) from the B-3 panel: revisit now or after Phase 3? | After — `useChain()`/`switchChain` signatures are already forward-compatible |

## 4. Explicitly out of scope for B-5
- Any EVM network user exposure (Phase 4).
- B-1/B-2 auth redesign.
- Tendermint-RPC lane rpcUrl honesty (`getValidators` etc. still discard it — recorded in
  KNOWN_ISSUES wording under B-4; only matters for cross-network telemetry, which no
  migrated page needs).
- Honoring the *viewed* network in the five B-4-pinned hooks (useGovDao, useYourWorlds,
  useEcosystemValidators, useDirectoryHighlights, ValidatorsHacker) — becomes trivial once
  pages consume `useChain()`, so fold it into the wave that migrates each page.
