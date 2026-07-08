# Memba — Backlog Plan (work starting 2026-07-08)

Captured 2026-07-07. Governing roadmap remains `MEMBA_ROADMAP_COMPOUND_2026-07.md` (#735); this plan is the near-term execution slice for the items zxxma dictated. **AMM/Dex is explicitly out** (major milestone, deferred).

## Session split (2026-07-08)

- **This (main) session, sequential:** item 0 (ICO popup — shipped), then 4, 5, 7.
- **Parallel focused sessions (dedicated prompts):** items 1, 2, 3, 6, 8. Each gets an isolated worktree + branch to avoid conflicts. See `docs/planning/PARALLEL_SESSION_PROMPTS_2026-07-08.md`.

## Sequencing rationale

Ordered by (a) time-sensitivity, (b) dependency, (c) risk. The ICO window and the fund-drain P0 dominate; product polish must not ship before the P0 is resolved on any money path.

| # | Item | Priority | Session |
|---|------|----------|---------|
| 0 | Gno ICO announcement popup | **P0 — time-boxed** (sale opens 2026-07-20) | this — DONE |
| 1 | Full samcrew-deployer + realms audit (resolve OriginSend P0) | **P0 — safety gate** | parallel |
| 2 | Verify plan coverage vs roadmap (except AMM/Dex) | P1 | parallel |
| 3 | Per-feature deep review, one by one | P1 | parallel |
| 4 | Merge Explorer + Directory → `/directory` | P2 — UX | this |
| 5 | Marketplace → single tabbed page (NFT/Services/Tokens) + menu | P2 — UX | this |
| 6 | +2 Store games (Space Invaders, Tetris) | P2 — growth | parallel |
| 7 | One article per feature (product + eng scope) | P2 — docs | this |
| 8 | On-chain blog realm (blog is static today) | P2 — infra | parallel |

## Owner decisions (2026-07-07)

1. **ICO popup — pure outbound link** to sale.gno.land (no in-app sale detail). ✅ built.
2. **Explorer+Directory — canonical route `/directory`;** redirect `/explorer` → `/directory`.
3. **Articles — on-chain blog realm.** ⚠️ `/blog` is NOT on-chain today: build-time glob over `frontend/content/blog/*.md` (`frontend/src/lib/blog.ts`); no realm in samcrew-deployer. Item 8 builds `memba_blog_v1`; item 7 authors markdown now (ships via current static pipeline), migrates to the realm keeping `/blog` slugs stable.
4. **Games — chain-seeded / (partially) on-chain, but playable WITHOUT a wallet.** Fully accessible unconnected; connect optional, only at the end (submit score / claim). Mirror Block Party's chain-seeded-daily model; no connect-gate on play.

## Conflict-avoidance rules (multiple concurrent sessions)

- Each session works in its own git worktree (`.claude/worktrees/<branch>`), never the shared `main` checkout.
- One feature = one branch = one PR, kept small and rebased on `origin/main` before finalize.
- Items 4 and 5 both touch `App.tsx` routing + the sidebar/menu — **serialize them** (5 rebases on 4, or land 4 first). Note the shared files in each PR.
- Never merge without explicit owner approval (even green CI).
- Pre-existing uncommitted artifacts in the main checkout (contract stubs, SESSION_SYNC.md) belong to other work — do not stage them.

## Item detail

### 0. Gno ICO popup — SHIPPED (branch `feat/gno-ico-announcement`)
`GnoIcoAnnouncement.tsx` (+test): centered dismissible modal, countdown copy auto-switches to "Live now" at 2026-07-20, CTA → sale.gno.land, localStorage one-shot per campaign, suppressed under onboarding wizard. Flag `VITE_ENABLE_ICO_ANNOUNCEMENT` (ordinary, not safety-gated). Owner: set the flag true in Netlify for the sale window, unset after.

### 4. Merge Explorer + Directory → `/directory`
Both are read-only realm surfaces; two entries confuse users. Unify into Directory; redirect `/explorer` → `/directory`. Explorer P1 (#804) + Directory Phase 0/1 already shipped — consolidation, not new build.

### 5. Marketplace → single tabbed page
Collapse NFTs / Services / Tokens into one page with tabs (a `UnifiedMarketplace` page already exists — extend it); mirror the single entry in the menu. **Never redeploy tokenfactory_v2.** Preserve per-lane fee→DAO; per-lane flags stay, tabs render conditionally.

### 7. One article per feature
Product framing + engineering scope so each doubles as documentation. Author as markdown in `content/blog/` now; migrates to the item-8 realm later.

## Parallel items (full prompts in the companion doc)
- **1** deployer + realms audit (resolve OriginSend/IsUserCall drain P0 first).
- **2** plan-coverage matrix vs roadmap (AMM/Dex = deferred, not missing).
- **3** per-feature deep review.
- **6** two wallet-optional chain-seeded games.
- **8** `memba_blog_v1` realm + migration + frontend reader.
