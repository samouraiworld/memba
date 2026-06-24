# Memba — Directory Page: Deep Audit & AAA Upgrade Plan (2026-06-24)

> **What this is:** a focused sub-plan for the `/:network/directory` page that slots into the master [`MEMBA_COMPLETE_AAA_PROGRAM_2026-06-24.md`](MEMBA_COMPLETE_AAA_PROGRAM_2026-06-24.md). It **supersedes the thin blocker scope of E0-b/E0-c/E5-f** with evidence-backed root causes (some are smaller than recorded, one is bigger), and adds the upgrade/optimization layers the existing program did not cover. Same conventions: branch-per-feature, per-PR approval, TDD with real-body fixtures, test13-only, nothing deferred-by-omission.
>
> **Method:** 3 parallel expert lenses (UX/a11y · frontend+backend engineering · live-chain verification) over the full Directory tree + live `curl` against test13 (canonical `rpc.test13.testnets.gno.land`, gnoweb `test13.testnets.gno.land`, samourai, aeddi) + a scan of the 56 upstream gno commits since the `chain/test13` pin. Every finding cites `file:line`.

---

## 1. Verdict snapshot

| Metric | Value |
|---|---|
| Page | `frontend/src/pages/Directory.tsx` (+ `directory.css` 1636L, 10 components, 7 tabs, `lib/directory.ts` 705L, backend `home_rpc.go`) |
| Overall | **Competent MVP, AAA-reachable.** Clean v3 component split; weak on discovery primitives, a11y, honesty, and multi-network correctness. |
| Upstream-gno breaking changes | **None** (high confidence — see §3). The pin delta is safe; the real issues are chain-side + one Memba bug. |
| Demo-critical truths | **DB1 validators=0 → 2-line fix**; **Users tab broken on test13** (chain-side); **DB4 tx_search 404 → gate off**; DB2 "raw markdown" is mostly cosmetic (escaped links). |
| Biggest architecture risk | `resilientAbciQuery` ignores its `rpcUrl` arg → network scoping is accidental; cross-network cache-poison risk on gnoland1 (`shared.ts:120`, `rpcFallback.ts:90`). |
| Biggest UX risk | No deep-linkable state (no `useSearchParams`) → nothing shareable; 7-tab entity-silo fragments discovery; dual search; cross-tab search covers 3 of 7 entities. |
| Biggest a11y gaps | Click-only tablist (no arrow keys/roving tabindex) [WCAG A]; drawers no focus trap/restore [A]; hardcoded `#333` contrast fails dark theme [AA]; no `prefers-reduced-motion`. |
| Effort envelope | Phase 0 (demo-critical) ≈ 1 day · Phases 1–3 (a11y/correctness/discovery) ≈ 3–4 days · Phase 4–5 (server snapshot + Atlas IA) ≈ multi-day each |
| Target | WCAG 2.2 AA; test13 correct today, gnoland1-ready; honest empty-vs-error states |

---

## 2. Scope & coordination (parallel-session safety)

We will work in parallel with other sessions. **Boundaries:**

- **Owned safely by this plan:** `pages/Directory.tsx`, `pages/directory.css`, `components/directory/**`, `lib/directory.ts`, `lib/gnoweb.ts`, `lib/dao/*` (directory-only consumers), `lib/validators.ts` (banner path).
- **⚠️ Home tree — coordinate, do not collide:** `hooks/home/useDirectoryHighlights.ts`, `components/home/doors/DirectoryDoor.tsx` are owned by the `fix/home-connected-feedback` branch (MH-series). **DB5/E5-f (member-count honesty) lives here** → leave it to that branch or hand off; this plan only *references* it. Direction C (Atlas-coherent landing) **depends on the Atlas `Door` primitive landing first** — sequence after home.
- **⚠️ Do not touch:** `memba-nft-phase2` worktree (`feat/nft-marketplace-phase2`, PR #443 held → E9-b).
- **Supersedes (reconcile with whoever holds them):** master-program **E0-b** (DB1/2/3), **E0-c** (DB4), and overlaps **E8-b** (RPC env drift) + **E5-e** (ecosystem honesty). If a parallel session already opened `fix/directory-blockers`, fold §5 root-cause corrections into it rather than branching anew.
- **Branch namespace:** `fix/directory-*`, `feat/directory-*`, `refactor/directory-*` (table per task in §6). Never commit to `main`; one feature per branch; per-PR approval even on green CI.

---

## 3. Breaking-change verdict (the explicit ask)

**The Gno core is 56 commits ahead of the pinned `chain/test13` (`f45cc5c88` → `origin/master 8723d4af5`). None of it breaks Memba.** Rationale, evidence-backed:

- **Backend has no gno-core/gnovm/tm2/gnoclient dependency** (`backend/go.mod` = cosmos-sdk + cometbft only, for amino/crypto). It speaks to test13 via raw HTTP `abci_query` + `/validators`. **Frontend is pure JSON-RPC over `fetch`.** Upstream Go-API changes can only reach Memba via *wire-format / render-output drift*, never via compilation.

| Upstream commit (since pin) | Surface it could touch | Verdict | Confidence |
|---|---|---|---|
| **#5649** refactor: state-explorer frontend | `gnoweb.ts:parseGnowebListing` scrapes `href="/r/…"` | **No break** — live `/r/samcrew` & `/p/samcrew` still emit `href="/r/…"`/`href="/p/…"`. Scraper still matches (DEGRADED by pre-existing `$source`/`$help` noise, not by this PR). | High |
| **#5655** gnoweb usernames-with-hyphens | username resolution | **No impact** — moot: `r/sys/users` emits no per-user listing to parse at all (see §5). | High |
| **#5834** gnoclient `QuerySessionAccount` | — | **No impact** — no gnoclient in the tree. | High |
| **#4951/#5848** out-of-gas error UX | `grc20.ts` broadcast error matching | **No impact** — Memba substring-matches `/out of gas/i` (`grc20.ts:186,198`); reads unaffected; worst case a reworded msg weakens a retry hint (cosmetic). | Med-High |
| #5854 docs test11→test13 | docs only | None | High |

**The genuine Directory breakages are NOT from the pin delta** — they are chain-side realities + a Memba bug (all detailed in §5): (a) `r/sys/users` returns a stats-only render and ignores the render path; (b) `/validators` has never returned a `.total` field; (c) test13 nodes don't expose `tx_search`. **Action:** one 30-second smoke-test of the gnoweb scraper is the only pin-related task (already folded into master E7-a); **do not** chase the upstream delta further. Keep the `chain/test13` pin.

> **test13/gnoland1 discipline:** the only stale `test12` reference in the directory path is a JSDoc example at `gnoweb.ts:120` (cosmetic, fix in Phase 1). No functional test11/test12 hardcoding exists in the data path (grep-confirmed). All new work targets test13 now and gnoland1 next (Phase 3 makes it network-correct).

---

## 4. Method & evidence

- **Live test13 verification** (`curl --max-time`): namespace scraper, `r/sys/users`, `tokenfactory_v2`, `memba_dao`, `r/gov/dao`, `tx_search`, `/validators`, `/status`. Each source rated PASS / DEGRADED / BROKEN with the parser `file:line`.
- **Cross-checks:** backend `home_rpc.go` independently corroborates two findings — it counts validators as `len(...Validators)` (`:559`, correct) and documents the `r/sys/users` stats-only render → `[]` (`:447`). Frontend/backend parsers are documented mirrors (`home_rpc.go:361`).
- **Severity = impact × likelihood ÷ effort**, demo-relevance weighted for Phase 0. WCAG 2.2 AA conformance target.

---

## 5. Blocker truth-up (supersedes E0-b / E0-c; corrects the record)

The master program lists DB1–DB4 as a single small `fix/directory-blockers` (E0-b/E0-c). Live evidence refines each:

| ID | Recorded | **Live truth (evidence)** | Real fix | Effort |
|---|---|---|---|---|
| **DB1** validators=0 | "source from working path" | `lib/validators.ts:318-319` reads `valResult.total`; gno tm2 `/validators` **never returns `total`** → `parseInt(undefined‖"0")=0`. 5 live validators on test13 (power 10, identical across canonical/onbloc/aeddi). Backend already does it right: `home_rpc.go:559` `len(v.Result.Validators)`. | Count `valResult.validators.length` (mirror backend). **2-line fix.** | **S** |
| **DB2** raw-markdown DAO card | "render/strip" | **Mostly cosmetic.** `memba_dao` render is named & discovered fine; the "raw" look = escaped `\>` link markup (gno#5418 escaping). No `Members: N`/`Proposals: N` strings exist → `parseDAORender` (`daoMetadata.ts:54,58`) yields 0/0 and the meta row hides (`DAOCard.tsx:75`). Real inconsistency: inline realm preview renders raw `<pre>` (`RealmsTab.tsx:164`) while the drawer renders markdown. | Unescape + render markdown in the inline preview (reuse drawer's `renderMarkdown`); accept that counts are absent until the realm exposes them. | **S** |
| **DB3** empty global search | "placeholder+icon or remove" | `Directory.tsx:67` returns `null` on zero cross-tab results — no affordance. Also cross-tab search only covers **DAOs/packages/realms** (`:52-69`); Tokens/Users/GovDAO/Leaderboard are silently excluded. | "No results" state + extend coverage to all 7 entities (Phase 2). | **S→M** |
| **DB4** GovDAO 63 console 404s | "feature-detect/guard tx_search" | **Confirmed:** `tx_search` returns **404 on both canonical and samourai** test13 nodes. `proposalDates.ts:110 searchProposalTx` → `resilientRpcCall` walks 3 nodes (`rpcFallback.ts:124`) → up to 3×404 per call → ~63 in console. Degrades silently (try/catch), so UX-only. | Detect-once / gate `tx_search` off for test13; stop the fan-out. | **S→M** |
| **NEW — Users tab BROKEN** | (not recorded) | `r/sys/users` Render returns **only a stats blob** ("Total unique addresses registered: 19"), no `* name addr` lines, and **ignores the render path** for `:addr`/`:name`. → `parseUserRegistry` (`directory.ts:327`) matches 0 → `fetchUsers` (`:352`) returns `[]`; `resolveUsername` (`shared.ts:162`) returns `""` → DAO member cards show raw `g1…`. The Users tab cannot work as designed on test13. | **Decision D2** (re-source via gnolove API / redesign as address-search / drop on test13). | **M** |

---

## 6. Implementation roadmap (dependency-ordered phases)

Effort: **S** ≈ hours · **M** ≈ ~1 day · **L** ≈ multi-day. Owner: **[Me]** code+PR · **[You]** operator/decision. Each row = one branch/PR, independently revertible. AC = acceptance criteria.

### PHASE 0 — Demo-critical truth-up (pre-Friday 2026-06-26; reconcile with E0-b/E0-c)
*Goal: the Directory the gno-core team sees on Friday is correct and quiet.*

| ID | Branch | What | Files | Why | AC / Test | Effort |
|---|---|---|---|---|---|---|
| D0-1 | `fix/directory-validators-count` | Count `validators.length`, not `.total` | `lib/validators.ts:318-319`; banner `ChainMetricsBanner.tsx:43` | DB1 — shows 0 despite 5 validators | Banner shows 5 on test13; unit test with a real `/validators` body (no `total` field) → 5; mirrors `home_rpc.go:559` | **S** |
| D0-2 | `fix/govdao-txsearch-gate` | Detect-once/gate `tx_search` off on test13; stop 3-node fan-out | `lib/dao/proposalDates.ts:110`, `rpcFallback.ts` | DB4 — 63 console 404s | 0 `tx_search` 404s in console on GovDAO tab; proposal dates degrade to render-derived; test asserts no call when capability absent | **S→M** |
| D0-3 | `fix/directory-dao-card-render` | Unescape + markdown-render the inline realm/DAO preview (reuse drawer renderer) | `RealmsTab.tsx:164`, `daoMetadata.ts` | DB2 — escaped `\>` reads as raw | Inline preview matches drawer formatting; snapshot test on a real `memba_dao` render fixture | **S** |
| D0-4 | `fix/directory-users-test13` | Per **D2**: re-source Users (gnolove API) **or** convert to address/username search **or** gate with honest "not available on test13" | `lib/directory.ts:327,352`, `UsersTab.tsx`, `lib/dao/shared.ts:162` | Users tab returns `[]`; members show raw `g1…` | No raw `g1…` where a handle is expected; honest empty-vs-unavailable copy; real-body fixture for the stats-only render → handled path | **M** |
| D0-5 | `fix/directory-empty-search-state` | "No results" affordance (folds DB3 minimal) | `Directory.tsx:67` | DB3 — silent null | Zero-result search shows guidance, not blank; E2E types nonsense → sees state | **S** |

### PHASE 1 — a11y + contrast + honesty quick wins (frontend-only, all S, one-or-two PRs)
*Goal: WCAG-clean and outage-honest without re-IA.*

| ID | Branch | What | Files | AC | Effort |
|---|---|---|---|---|---|
| D1-1 | `fix/directory-tablist-keyboard` | Arrow/Home/End nav + roving `tabindex` on the tablist | `Directory.tsx:202-224` | WCAG 2.1.1; keyboard cycles tabs; axe clean | **S** |
| D1-2 | `fix/directory-reduced-motion` | `@media (prefers-reduced-motion)` guard (covers fadeIn/glow/shimmer/drawer/hover) | `directory.css` | WCAG 2.3.3; motion off when requested | **S** |
| D1-3 | `fix/directory-contrast-tokens` | Replace hardcoded `#333` → theme tokens (arrows, line-numbers, tree prefix) | `directory.css:284,1332,1417` | AA contrast both themes; fixes dark-theme near-invisible arrows | **S** |
| D1-4 | `fix/directory-arialive-counts` | `role="status"`/`aria-live="polite"` on per-tab result counts | `TokensTab:73`, `PackagesTab:46`, `RealmsTab:113`, `UsersTab:107` | WCAG 4.1.3; SR announces "N results" | **S** |
| D1-5 | `fix/directory-silent-failures` | Distinguish empty vs error; let throws reach the existing Retry UI (stop `catch→[]` masking) | `directory.ts:316,226,546,651`; `gnoweb.ts:138,161` | Outage shows error+Retry, not "No tokens"; aligns with E5 honesty | **M** |
| D1-6 | `chore/directory-stale-comment` | Drop the `test12.moul.p2p.team` JSDoc example | `gnoweb.ts:120` | test13/gnoland1-only references | **S** |

### PHASE 2 — Discovery UX layer (the "explorer" upgrade)
*Goal: the discovery primitives an explorer needs; deep-linkable; demo-shareable.*

| ID | Branch | What | Files | AC | Effort |
|---|---|---|---|---|---|
| D2-1 | `feat/directory-url-state` ⭐ | Deep-linkable `?tab=&q=&sort=&cat=&page=` via `useSearchParams` (keystone for sort/facet) | `Directory.tsx:31-35`, tabs' local state | Reload/back/share preserves view; E2E asserts URL round-trip | **M** |
| D2-2 | `feat/directory-sort` | Shared sort bar (newest / alphabetical / most-members) across tabs | new `DirectorySortBar`; wire each tab `useMemo` | Sort changes order + URL; "newest" surfaces fresh on-chain items | **M** |
| D2-3 | `feat/directory-facets` | Use existing `DAOCategory` for a DAO filter; unify realm category pills; selected-state not color-only | `DAOCard.tsx:13/67`, `RealmsTab.tsx:92-111`, `directory.css:231` | Faceting on DAOs+realms; WCAG 1.4.1 selected-state has non-color cue | **M** |
| D2-4 | `feat/directory-crosstab-all7` | Extend cross-tab search to Tokens/Users/GovDAO/Leaderboard | `Directory.tsx:52-69` | Global search spans all 7 entity types | **M** |
| D2-5 | `fix/directory-drawer-focus` | Focus trap + initial focus + restore-on-close in drawers | `RealmDetailDrawer.tsx:101`, `TokenDetailDrawer.tsx:47` | WCAG 2.4.3; Tab stays in drawer; focus returns to opener | **M** |
| D2-6 | `fix/directory-mobile-targets` | `.dir-tab`≥44px, save-btn/pills ≥24px hit area; tab scroll-snap + edge fade; keep live dot on mobile | `directory.css:55,432,214,46,651` | WCAG 2.5.8; thumb-usable on ~380px | **M** |
| D2-7 | `feat/directory-empty-invitations` | Empty states → Atlas `invitation` with CTA ("Create the first DAO →") | `directory.css:347`, tab empties (`GovDAOTab:63`…) | Never blank/`0`/`—`; dead ends become actions | **M** |

### PHASE 3 — Multi-network correctness (gnoland1-ready)
*Goal: nothing accidental; correct on the next network.*

| ID | Branch | What | Files | AC | Effort |
|---|---|---|---|---|---|
| D3-1 | `refactor/directory-rpc-threading` ⭐ | Thread `rpcUrl`/URL-list through `abciQuery`→`resilientAbciQuery`; align cache key + RPC on one `getActiveNetworkKey` | `shared.ts:120-122`, `rpcFallback.ts:90`, `directory.ts:89-91,128` | No accidental scoping; SPA switch-without-reload queries right chain; cache-poison test | **M** |
| D3-2 | `feat/directory-per-network-paths` | Source GovDAO/namespace/token paths from per-network `config.ts`; gate cards with `isRealmValidOn` | `GovDAOTab:16`, `directory.ts:139,312,552,657`, `config.ts:201-242,533-548` | gnoland1 shows callable items only; non-deployed → gated state, not VM 500 | **M** |
| D3-3 | `fix/backend-chainid-rpc-map` | Backend `chainID → rpcURL` map; stop collapsing client `chain_id` | `home_rpc.go:31-39,105-107` | Snapshot honors `chain_id`; fixes home + future directory snapshot at once; TDD | **M** (BE) |

### PHASE 4 — Server snapshot architecture (AAA capstone; post-demo)
*Goal: kill N+1, enable server-side pagination/sort/search + per-source honesty. Mirrors `GetHomeSnapshot`.*

| ID | Branch | What | Files | AC | Effort |
|---|---|---|---|---|---|
| D4-1 | `feat/directory-snapshot-proto` | Add `GetDirectorySnapshot(chain_id,tab,page,page_size,query,sort)` → `{users,tokens,daos,total,generated_at,stale_sources}` | `api/memba/v1/memba.proto` (+ regen) | Bindings build; proto-lint clean | **M** (proto) |
| D4-2 | `feat/directory-snapshot-backend` | Handler clones `cachedHomeSnapshot`; per-source fault-tolerant → `stale_sources`; consolidates the FE/BE-mirrored parsers server-side | `home_rpc.go` template (`:121-193`) | 30s TTL cache; stale-on-error; real-body fixtures | **L** (BE) |
| D4-3 | `feat/directory-usequery-migration` | Migrate tabs to react-query against the snapshot (delete bespoke lo/err/retry; unify caching); phase **Users→Tokens→DAO-meta** | all `tabs/*.tsx`, `queryClient.ts` | Dedup, retry, stale-on-error, devtools; DAOsTab N+1 + 10-cap truncation gone | **L** |
| D4-4 | `fix/directory-chainbanner-snapshot` | Banner reads height/validators/block-time from snapshot (already computed) instead of 3-RPC/30s self-poll | `ChainMetricsBanner.tsx:43`, `validators.ts:303` | One source of truth; failover for free | **S** |

### PHASE 5 — Atlas-coherent IA (Direction C; after home `Door` primitive lands)
*Goal: the page fulfills the `DirectoryDoor` "find anything" promise and feels like one product with Atlas.*

| ID | Branch | What | Files | AC | Effort |
|---|---|---|---|---|---|
| D5-1 | `feat/directory-atlas-landing` | Curated landing (featured + "new this week", honestly sourced) reusing the Atlas `Door` primitive; tabs become a facet rail; search front-and-center to match the door | `Directory.tsx`, new section; reuse `components/home/doors/*` | Per **D1**; first viewport sells the ecosystem; no fake activity | **L** |
| D5-2 | `feat/directory-live-summary-header` | Header → `● live · block · validators · N DAOs · N realms` strip (Atlas StatusStrip parity) | `Directory.tsx:100`, `directory.css:30` | Network-aware, never blank | **S→M** |

---

## 7. Decision points (need your call — CTO recommendation first)

- **D1 — IA direction.** **(A)** refine current 7 tabs · **(B)** unified search-first explorer · **(C, recommended)** curated landing + faceted drill-down, reusing the Atlas `Door` primitive. C is the only option that fixes IA + discovery *and* coheres with the Atlas home; it's also the most work and depends on the home `Door` primitive. **Rec: C as the Phase-5 north star; Phases 0–4 are direction-agnostic and ship value regardless.**
- **D2 — Users tab on test13** (it's broken chain-side). **(a, recommended)** re-source the listing from the gnolove API (already used for avatars) + keep address/username search → matches the `DirectoryDoor` "find anyone" promise · **(b)** drop the Users *listing* on test13, keep a single address/username lookup · **(c)** gate the tab with an honest "registry listing not available on test13" until gnoland1. **Rec: (a)** — best demo story, reuses an existing dependency.
- **D3 — Demo scope for Friday.** **Rec:** Phase 0 only (D0-1…D0-5) + the Phase-1 a11y quick wins if time. Phases 2–5 are post-demo. Confirm you want me to prioritize Phase 0 this week.
- **D4 — Architecture ambition.** Build the `GetDirectorySnapshot` backend RPC (Phase 4, AAA, fixes N+1 + enables server-side sort/search) **or** stay client-side and just add caching + react-query? **Rec:** do Phase 4 post-demo — it's the durable fix and reuses the proven `GetHomeSnapshot` pattern.

---

## 8. Coverage matrix (nothing dropped)

| Finding | Phase/Task | Status |
|---|---|---|
| DB1 validators=0 (`.total` bug) | D0-1 | planned (supersedes E0-b) |
| DB2 raw-markdown DAO/realm preview | D0-3 | planned (supersedes E0-b) |
| DB3 empty global search + 3/7 coverage | D0-5 + D2-4 | planned (supersedes E0-b) |
| DB4 tx_search 404s | D0-2 | planned (supersedes E0-c) |
| Users tab broken on test13 (NEW) | D0-4 (D2) | planned |
| DB5 member-count honesty | E5-f (home branch) | **delegated — coordinate** |
| Tablist keyboard / roving tabindex | D1-1 | planned |
| prefers-reduced-motion | D1-2 | planned |
| Hardcoded `#333` contrast | D1-3 | planned |
| aria-live on counts | D1-4 | planned |
| Silent `catch→[]` (E5 honesty) | D1-5 | planned (overlaps E5-e) |
| Stale test12 JSDoc | D1-6 | planned |
| Deep-linkable URL state | D2-1 | planned |
| Sorting | D2-2 | planned |
| Faceting (DAO category, realm pills, non-color selected) | D2-3 | planned |
| Cross-tab search all 7 | D2-4 | planned |
| Drawer focus trap/restore | D2-5 | planned |
| Mobile tap targets / tab overflow / live dot | D2-6 | planned |
| Empty→invitation states | D2-7 | planned |
| `resilientAbciQuery` ignores rpcUrl / cache-key scoping | D3-1 | planned |
| Hardcoded per-network paths (GovDAO/namespace/token) | D3-2 | planned (overlaps E8-b) |
| Backend single-network `chain_id` collapse | D3-3 | planned (fixes home + directory) |
| DAOsTab N+1 + 10-cap silent truncation + no cache | D4-3 (interim cache in D4-3 split) | planned |
| react-query migration | D4-3 | planned |
| `GetDirectorySnapshot` RPC | D4-1/D4-2 | planned |
| ChainMetricsBanner 3-RPC poll, no failover | D4-4 | planned |
| Atlas-coherent IA (Direction C) | D5-1 | planned (after home Door) |
| Live-summary header | D5-2 | planned |
| Test gaps (cache TTL/scoping, parseDAORender, error-vs-empty, real-RPC fixtures) | woven into each task's AC | planned |
| Upstream gno pin delta | §3 — smoke-test only (E7-a) | verified safe |

---

## 9. Test plan (AAA)

- **TDD with real-body fixtures** (project mandate — no synthetic): capture live test13 renders for `tokenfactory_v2:`, `r/sys/users:` (the stats-only case), `memba_dao:`, `r/gov/dao:proposals`, and a real `/validators` body **with no `total` field**. Share these fixtures between the FE parsers and the BE mirrors (`home_rpc.go`).
- **Unit:** validators count, cache TTL + network-scoping, `parseDAORender`, cross-tab search, error-vs-empty, `tx_search`-absent path.
- **E2E (`directory.spec.ts`):** all 7 tabs; URL-state round-trip; keyboard tablist; drawer focus trap; empty/error states; mobile overflow.
- **a11y:** axe + Lighthouse contrast on every tab, both themes; reduced-motion honored.

## 10. Owner handoffs ([You])

1. **Decisions D1–D4** (§7) — your call shapes Phases 4–5 + the Users strategy.
2. **Per-PR merge approval** — every PR, even green CI.
3. **Coordinate E5-f/DB5** with the `fix/home-connected-feedback` session (member-count honesty in the home tree).
4. (If D2-a) confirm the gnolove API endpoint that lists/looks-up users for the active network.

## 11. Self-review (against the request)

- **"git pull all repos + check activity for breaking changes on Memba"** → §3: all repos synced (behind=0); 56-commit gno delta scanned and verified safe with evidence; the real issues are chain-side, not upstream.
- **"How could the Directory be upgraded/fixed/optimized — code + UI/UX"** → code (Phases 1/3/4: honesty, network-correctness, N+1/architecture), UI/UX (Phases 2/5: discovery primitives, a11y, mobile, Atlas IA). Three expert lenses, every finding `file:line`.
- **"test13 only, never test12/11"** → §3 confirms no functional test12/11 in the path; D1-6 removes the one stale comment; Phase 3 makes it gnoland1-ready.
- **"AAA standards"** → branch-per-feature, per-PR approval, TDD real-body fixtures, WCAG 2.2 AA, coverage matrix, revertible phases, slots into the master program.
- **"avoid conflicts / parallel sessions"** → §2 boundaries: home tree delegated, NFT worktree untouched, E0-b/c/E8-b reconciliation explicit.
