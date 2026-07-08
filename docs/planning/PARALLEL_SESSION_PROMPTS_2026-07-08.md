# Parallel focused-session prompts — 2026-07-08

Copy-paste each block into its own Claude Code session. They are designed to run
**concurrently without conflicts**. Companion to `BACKLOG_PLAN_2026-07-08.md`.

## Rules every session must follow (shared)

- **Work in an isolated git worktree**, never the shared `main` checkout (other
  sessions use it). One feature = one branch = one PR.
- **Rebase on `origin/main` before finalizing.** **Never merge without explicit
  owner approval**, even on green CI.
- **No Claude branding** in commits/PRs (no co-author, no "Generated with" footer).
  Commit style: one concise line, why-focused.
- **TDD, flag-gated dark.** New surfaces ship behind a `VITE_ENABLE_*` (ordinary)
  flag off by default; money paths use the build-time `SAFETY_GATED_FLAGS` gate.
- **Multi-perspective expert audit before AND after** implementation (owner
  preference). Produce ONE consolidated MD per session.
- Frontend is standalone npm: `cd frontend && npm ci` in a fresh worktree.
  `tsc --noEmit` is a no-op — verify with `npm run build`. Run vitest one file at
  a time in a bounded self-killing wrapper (never `npx`).

## In-flight PRs from the 2026-07-08 main session — DO NOT collide

| PR | Branch | Touches (rebase around these) |
|----|--------|-------------------------------|
| #809 | `feat/gno-ico-announcement` | `Layout.tsx`, `config.ts`, `.env.example`, planning docs |
| #811 | `feat/directory-explorer-merge` | `App.tsx` (routes), `navManifest.ts`, `pages/Directory.tsx`, `pages/Explorer.tsx`, explorer/directory libs |
| #813 | `feat/marketplace-unified-tabs` | `navManifest.ts`, `navManifest.test.ts`, `Sidebar.test.tsx` |
| #814 | `docs/feature-articles` | `frontend/content/blog/2026-07-08-*.md` |

**`navManifest.ts` and `App.tsx` are hot files** (#811, #813). Items 6 and 8
below also touch them — branch from `origin/main` and expect to rebase once those
land.

---

## Item 1 — samcrew-deployer + all-realms audit (P0 safety gate)

```
You are auditing the Memba on-chain stack for fund-safety and launch-readiness.

CONTEXT
- Repos: /Users/zxxma/Desktop/Code/Gno/samcrew-deployer (realms + deploy tooling)
  and /Users/zxxma/Desktop/Code/Gno/Memba (frontend/backend that call them).
- Prior audits (read first, then RE-VERIFY at current origin/main — anchors drift):
  docs in Memba memory referenced as project_samcrew_deployer_audit_2026_07_07 and
  project_memba_longterm_plan_2026_07_07.
- KNOWN LIVE P0 CLASS: unguarded OriginSend read without an IsUserCall guard, which
  lets a realm-to-realm call drain user funds. Confirmed sites: candidature_v2.Apply
  and agent_registry.DepositCredits (LIVE on test13); escrow_v2.FundMilestone
  (commerce-v2); token_otc_v1.Fill (base deploy scope, not yet deployed).
  Reference guard pattern: memba_appstore_v1 appstore.gno around line 125.

OBJECTIVE
1. Re-verify every OriginSend/IsUserCall site firsthand (grep proof + a runnable
   repro or a gno test). Confirm or refute each with file:line at current HEAD.
2. Produce a per-realm readiness table: deployed? guarded? tested? documented?
   multisig admin? fee path verified on-chain?
3. Fix the confirmed drain class (add IsUserCall guards) TDD, one realm per commit,
   with a gno test proving the guard rejects a realm-caller and accepts a user call.
4. Reconcile the two overlapping Jul-7 plans into one.

SCOPE / OUT OF SCOPE
- In: all deployer realms + the frontend/backend flags that gate their money paths.
- Out: AMM/Dex (deferred). Do not deploy or de-gate anything without owner sign-off.

GATE: no money-path de-gate and no mainnet until the drain class is closed.

DELIVERABLES: one consolidated audit MD (before+after expert passes), the guard
fixes as separate PRs in samcrew-deployer (never merge without approval), and an
updated readiness table. Follow the shared rules above.
```

---

## Item 2 — plan-coverage verification vs the roadmap

```
Verify what Memba actually shipped against the governing plans, and surface gaps.

CONTEXT
- Governing roadmap: docs/planning/MEMBA_ROADMAP_COMPOUND_2026-07.md (PR #735) in
  /Users/zxxma/Desktop/Code/Gno/Memba. Also the long-term plan
  (project_memba_longterm_plan_2026_07_07) and the compound program memory.
- Truth sources for "shipped": git history on origin/main, the VITE_ENABLE_* flags
  in frontend/src/lib/config.ts + .env.example, and deployed realms in samcrew-deployer.

OBJECTIVE
Produce a coverage matrix: for every roadmap item / wave deliverable, mark
Built / Partial / Missing / Deferred, with the evidence (commit, flag, or realm).
Explicitly mark AMM/Dex as DEFERRED (not missing). Call out anything Partial that
is silently dark (flag off, realm undeployed) so it doesn't read as done.

SCOPE: read-only analysis. No code changes. One consolidated MD deliverable with
the matrix + a short "gaps to schedule" list. This informs items 3, 6, 8.

Follow the shared rules (worktree only if you write the MD into the repo; otherwise
a scratchpad MD is fine).
```

---

## Item 3 — per-feature deep review, one by one

```
Do a systematic deep review of Memba, one feature at a time.

CONTEXT
- /Users/zxxma/Desktop/Code/Gno/Memba. Feature list: Multisig, DAO governance
  (+candidature +AI analyst), Marketplace (NFT/services/tokens lanes), App Store,
  Directory (+merged Explorer), Social Feed, Block Party, Validators (+reviews),
  Quests/XP, Alerts, Gnolove, Organizations.
- The 2026-07-08 feature articles (frontend/content/blog/2026-07-08-*.md, PR #814)
  are a good map of intended behavior — verify reality against them.

OBJECTIVE
For each feature, one focused pass covering: product state, on-chain enforcement
state, flag/deploy state, doc state, test coverage, and open bugs/risks. Rank
findings by severity. Where a money path or auth path is involved, coordinate with
item 1 rather than duplicating it.

APPROACH: use a review workflow — fan out one reviewer per feature, then an
adversarial verify pass on the load-bearing findings (owner prefers before+after
expert passes). Deliver ONE consolidated MD ranked most-severe first. No code
changes in this session unless a finding is a trivial safe fix; otherwise file it.

Follow the shared rules.
```

---

## Item 6 — two wallet-optional, chain-seeded games

```
Add two games to the Memba App Store, following the Block Party template.

CONTEXT
- /Users/zxxma/Desktop/Code/Gno/Memba. Study Block Party first:
  frontend/src/game + frontend/src/pages/BlockPartyGame.tsx +
  backend/internal/blockparty/*. It is a chain-seeded daily 2048 with a
  byte-identical TypeScript/Go engine and a server-validated leaderboard, gated by
  VITE_ENABLE_GAME / BLOCKPARTY_ENABLED.
- App Store realm: memba_appstore_v2 (listings), page at /apps.

OWNER DECISION (2026-07-08): games must be "chain-seeded / (partially) on-chain,
but PLAYABLE and fully accessible WITHOUT a wallet." Connect is OPTIONAL and only
at the end (submit score / claim). No connect-gate on play.

OBJECTIVE
Build two games — a Space-Invaders-like and a Tetris — each:
- Fully playable disconnected; wallet connect optional, only for score submission.
- Chain-seeded daily where it makes the game fairer/shared (mirror Block Party's
  deterministic seed); pure-client Practice mode otherwise.
- Listed in the App Store alongside Block Party.
- Shipped DARK behind a VITE_ENABLE_* flag; if a leaderboard is server-validated,
  never call it "trustless."

CONFLICTS: registering the games as App Store listings + any nav/route touches will
hit App.tsx and possibly navManifest.ts — branch from origin/main and rebase after
PRs #811/#813 land. One game per PR is fine.

APPROACH: TDD; if there's a shared move/score engine, keep TS and Go byte-identical
with shared test vectors like Block Party. Annotate bounded integer casts for gosec.
Follow the shared rules.
```

---

## Item 8 — on-chain blog realm (`memba_blog_v1`) + migration

```
Move Memba's blog on-chain and migrate the existing articles onto it.

CONTEXT
- Today /blog is STATIC: a build-time glob over frontend/content/blog/*.md parsed by
  frontend/src/lib/blog.ts (+ blogParser.ts). Route: /blog and /blog/:slug
  (pages/Blog.tsx). There is NO blog realm in samcrew-deployer yet.
- The 2026-07-08 articles (PR #814) are the migration payload.

OBJECTIVE
1. Build a memba_blog_v1 realm in samcrew-deployer: store articles (title, date,
   description, tags, body) + a Render() and read queries. Authoring is an admin/
   multisig flow; the public path is read-only. If authoring writes fees, treat the
   flag as SAFETY_GATED; if it's pure read render, it's an ordinary flag.
2. Add a frontend reader that fetches articles via qrender/qfile (mirror the
   Directory Explorer's read-only ABCI approach) and replaces the build-time glob in
   blog.ts — behind a VITE_ENABLE_* flag, with the static glob as the fallback until
   the realm is deployed and verified.
3. Migrate the content/blog/*.md articles onto the realm. KEEP /blog route + every
   slug stable (slug = filename minus date prefix) so existing links don't 404.

SCOPE: realm + reader + migration. Out: a rich authoring UI (later).

CONFLICTS: touches blog.ts, Blog.tsx, config.ts (new flag), .env.example, and adds a
realm in samcrew-deployer. config/.env overlap #809 — rebase on origin/main after it
lands. Deploy only with owner sign-off.

APPROACH: TDD the reader + slug-stability; verify Render() output sanitizes like the
Explorer. Follow the shared rules.
```

---

Launch order suggestion: **1 first** (it gates everything money/mainnet), 2 and 3
in parallel (read-only, they inform the rest), then 6 and 8 once #811/#813 land (to
minimize `App.tsx`/`navManifest` rebases).
