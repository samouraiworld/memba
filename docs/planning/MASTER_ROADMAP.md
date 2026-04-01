# Memba v2.x — Master Roadmap

> **Status tracker for all milestones. Updated at the end of each session.**
> Last updated: 2026-04-01 (v2.27 docs hygiene)

## Milestone Status

| # | Codename | Phase | Status | Branch |
|---|----------|-------|--------|--------|
| 1 | **Foundation** | v2.0-α | ✅ SHIPPED | `dev/v2` |
| 2 | **Board** | v2.0-β | ✅ SHIPPED | `dev/v2` |
| 3 | **Swap** | v2.0-γ | ✅ SHIPPED | `dev/v2` |
| 4 | **Polish** | v2.0-δ | ✅ SHIPPED | `dev/v2` |
| 5 | **UX & Consistency** | v2.0-ε | ✅ SHIPPED | `dev/v2` |
| 6 | **Sidebar + Sentry** | v2.0-ζ | ✅ SHIPPED | PR #69 → `dev/v2` |
| 7 | **UX Audit Sprint** | v2.0-η | ✅ SHIPPED | PR #70 → `dev/v2` |
| 8 | **UX Polish** | v2.0-θ | ✅ SHIPPED | PR #71 → `dev/v2` |
| 9 | **Community Foundation** | v2.1a | ✅ SHIPPED | PR #74 → `dev/v2` |
| 10 | **Validators & Notifications** | v2.1b | ✅ SHIPPED | PR #75 → `dev/v2` |
| 11 | **Organization Directory** | v2.2a | ✅ SHIPPED | PR #76 → `dev/v2` |
| 12 | **Directory Enrichment** | v2.2b | ✅ SHIPPED | PR #77 → `dev/v2` |
| 13 | **Quick Wins** | v2.2c | ✅ SHIPPED | PR #78 → `dev/v2` |
| 14 | **Channels & Comms** | v2.5 | ✅ SHIPPED | PR #79 → `dev/v2` |
| 15 | **Hardening & OSS Prep** | v2.6 | ✅ COMPLETE | `dev/v2` |
| 16 | **Monitoring Integration** | v2.7 | ✅ COMPLETE | `dev/v2` |
| 17 | **Consolidation & Main Merge** | v2.9 | ✅ SHIPPED | PR #80 → `main` |
| 17a | **Production Bug Fixes** | v2.9.2 | ✅ SHIPPED | PR #81 → `main` |
| 17b | **Directory Expansion** | v2.9.3 | ✅ SHIPPED | PR #82 → `main` |
| 18 | **v2.10 Audit Bug Fixes** | v2.10 | ✅ SHIPPED | PR #83 → `main` |
| 19 | **Portal PiP** | v2.10 | ✅ SHIPPED | PR #84 → `main` |
| 20 | **Creative Landing** | v2.10.1 | ✅ SHIPPED | PR #86 → `main` |
| 21 | **Live ABCI Stats** | v2.11 | ✅ SHIPPED | PR #93 → `main` |
| 22 | **DAO Rooms & Health Score** | v2.12 | ✅ SHIPPED | PR #94 → `main` |
| 23 | **v2.12 Hardening** | v2.12 | ✅ SHIPPED | PR #96 → `main` |
| 24 | **Slug + Proposals Fix** | v2.12 | ✅ SHIPPED | PR #98 → `main` |
| 25 | **Tier 1 Security Audit** | v2.12 | ✅ SHIPPED | PR #99 → `main` |
| 26 | **v2.13 Deep Audit** | v2.13 | ✅ SHIPPED | PR #100 → `main` |
| 27 | **v2.13 Betanet Plan** | v2.13 | ✅ SHIPPED | PR #97 → `main` |
| 28 | **Hacker Gnockpit Parity** | v2.14 | ✅ SHIPPED | PR #124 → `main` |
| 29 | **gnoland1 Network** | v2.14 | ✅ SHIPPED | PR #125-126 → `main` |
| 30 | **test11 Re-activation** | v2.16 | ✅ SHIPPED | PR #128-129 → `main` |
| 31 | **Monitoring + Deps Cleanup** | v2.17 | ✅ SHIPPED | PR #142 → `main` |
| 32 | **Validator Perf & Hardening** | v2.17.2 | ✅ SHIPPED | PR #143-145 → `main` |
| 33 | **Professional Alerting** | v2.18 | ✅ SHIPPED | PR #147-151 → `main` |
| 34 | **Gnolove Consolidation** | v2.19 | ✅ SHIPPED | PR #152-157 → `main` |
| 35 | **CI Fix + Docs Sweep** | v2.20 | ✅ SHIPPED | `main` |
| 36 | **CSP Security + Docs** | v2.27 | ✅ SHIPPED | PR #215 → `main` |
| 37 | **Coming Soon Gates** | v2.27 | ✅ SHIPPED | PR #216 → `main` |
| 38 | **Quest Backend** | v2.27 | ✅ SHIPPED | PR #217 → `main` |
| 39 | **Feature Activation Plans** | v2.27 | ✅ SHIPPED | PR #218 → `main` |
| — | **Revenue & Sustainability** | v2.3 | 📋 PLANNED | — |
| — | **Marketplace & AI** | v3.0 | 📋 PLANNED | — |
| — | **Premium** | v3.5 | 🔮 HORIZON | — |
| — | **Horizon** | v4.0 | 🔮 HORIZON | — |

## Quality Gates (as of v2.27)

| Metric | Value |
|--------|-------|
| Unit tests | 1,349 (59 files) |
| E2E specs | 16 spec files |
| TypeScript errors | 0 |
| Lint errors | 0 |
| Build size | ~481KB (~140KB gzip) |
| package.json | 2.27.0 |

## v2.2b — Directory Enrichment (✅ SHIPPED — PR #77)

> **Goal:** Complete deferred items from v2.1b + v2.2a HANDOFFs. Quick wins + medium features.

| # | Feature | Source | Complexity | Status |
|---|---------|--------|------------|--------|
| 1 | **DAO Category Tags** — governance/community/treasury labels | v2.2a HANDOFF | Small | ✅ |
| 2 | **User IPFS Avatars** — avatar display in directory user cards | v2.2a HANDOFF | Small | ✅ |
| 3 | **Token Detail Navigation** — click token → `/tokens/:symbol` | v2.2a HANDOFF | Small | ✅ (already in v2.2a) |
| 4 | **Per-DAO Notification View** — DAO-specific count/filter in DAOHome | v2.1b HANDOFF | Medium | ✅ |
| 5 | **Contribution Scores** — proposal activity metric on user cards | v2.2a HANDOFF | Medium | ✅ |
| 6 | **DAO Auto-Discovery** — scan on-chain DAO factories | v2.2a HANDOFF | Medium-Large | ✅ |

## v2.2c — Quick Wins (✅ SHIPPED — PR #78)

| # | Feature | Status |
|---|---------|--------|
| 1 | **Sidebar Notification Badges** — notifUnreadCount on DAOs nav | ✅ |
| 2 | **IPFS Avatars in Directory** — gnolove batch fetch + resolveAvatarUrl | ✅ |
| 3 | **Typed BankMsgSend** — BankMsgSend interface | ✅ |

### Still Deferred (Lower Priority)

| Feature | Source | Notes |
|---------|--------|-------|
| Validator monikers (human names) | v2.1b HANDOFF | ✅ Code ready — blocked on CORS PR [#60](https://github.com/samouraiworld/gnomonitoring/pull/60) + VPS config |
| Faucet Phase 3 (treasury signing) | v2.1b HANDOFF | Backend concern |

## v2.5 — Channels & Comms (✅ SHIPPED — PR #79)

> **Goal:** Full channel experience with real-time messaging and audio/video rooms.

| # | Sub-milestone | Key Features | Status |
|---|--------------|-------------|--------|
| 1 | **v2.5a Channel Pages** | Standalone `/channels/:daoSlug` route, sidebar nav, reuse BoardView | ✅ |
| 2 | **v2.5b Real-time UX** | 10s polling, "new messages" toast, Page Visibility pause | ✅ |
| 3 | **v2.5c Audio/Video** | Jitsi Meet iframe, voice/video channel types (🔊/🎥) | ✅ |

## v2.6 — Hardening & OSS Prep (✅ COMPLETE)

> **Goal:** Fix all critical audit findings, prepare for OSS community, first revenue features.
> **Scope:** 4 phases, 40+ tasks from 22-perspective deep audit.

| # | Phase | Key Tasks | Status |
|---|-------|-----------|--------|
| 0 | **Critical Bug Fix** | Board deploy `import "std"` failure on test11 | ✅ |
| 1 | **Hardening Sprint** | CSP, error messages, gas config, tx retry, Dependabot | ✅ |
| 2 | **OSS Launch Prep** | README, Cmd+K palette, error message layer | ✅ |
| 3 | **Executable Proposals** | Already implemented (buildExecuteMsg, handleExecute, UI) | ✅ |

> **Deferred from v2.6:** BoardView decomposition (676 LOC, stable), onboarding tooltips, GnoSwap (→ FUTURE)
> **Full plan:** [v2.6-hardening/IMPLEMENTATION.md](milestones/v2.6-hardening/IMPLEMENTATION.md)

## v3.0 — Marketplace & AI (PLANNED)

> **Goal:** Extension hub, NFT marketplace, AI governance assistant.

| # | Sub-milestone | Key Features | Est. |
|---|--------------|-------------|------|
| 1 | **v3.0a Extension Hub** | Plugin marketplace, install/uninstall per-DAO, "Official" badges | 1-2 sessions |
| 2 | **v3.0b NFT Integration** | GRC721 minting, IPFS gallery, transfer | 1-2 sessions |
| 3 | **v3.0c AI Facilitator** | Proposal summarizer, voting guidance, read-only chat | 1-2 sessions |

## v2.3 — Revenue & Sustainability (PLANNED)

> **Goal:** Monetization layer + advanced governance.

| # | Feature | Complexity | Status |
|---|---------|------------|--------|
| 1 | **GnoSwap Slippage + Swap Execution** | Medium (spec in `GNOSWAP_SLIPPAGE.md`) | 🔮 DEFERRED |
| 2 | **Executable Proposals** — automated membership changes via governance | Large | ✅ DONE (v2.6) |
| 3 | **Subscription Realms** — on-chain premium tiers ($MEMBA gating) | Large | 📋 PLANNED |
| 4 | **Sponsorships** — project-based DAO funding | Medium | 📋 PLANNED |

## v3.0 — Marketplace (HORIZON)

| Feature | Notes |
|---------|-------|
| **Professional Services Marketplace** for DAOs | DAO-to-contributor matching |
| **Extension Hub** — MembaDAO curates "Official" badges | Plugin marketplace |
| **AI Facilitator** — proposal summarization, voting guidance | Read-only bot, LLM integration |

## v3.5 — Premium (HORIZON)

| Feature | Notes |
|---------|-------|
| **Governance-as-a-Service** | White-label DAO tooling |
| **Ad Hub** — decentralized ad placement | Gno project promotion |
| **NFT Metadata** — IPFS via nft.storage | Client-side pinning, CID on-chain |

## v4.0 — Horizon (HORIZON)

| Feature | Notes |
|---------|-------|
| **Inter-DAO Bridge** + sovereign community hub | Cross-chain governance |
| **Audio/Video** — Jitsi Meet or OSS P2P E2E | Self-hosted, iframe embed |
| **Validator Service** — separate project (~€200/mo) | Scaleway VPS, Stripe billing |

## Chain Targets

| Chain | Status | Memba target |
|-------|--------|-------------|
| test12 ⭐ | ✅ Active (default) | All dev + testing |
| test11 | ✅ Active (legacy) | Maintained for compatibility |
| gnoland1 (Betanet) | ✅ Active | Deployed since v2.14 |
| Mainnet | 🟡 ~H2 2026 | Track upstream |

## ⚠️ Upstream Tracking

| Issue | Status | Impact |
|-------|--------|--------|
| `r/gnoland/users` removed (gno PR #5194) | 🟡 PENDING | 13 references in Memba. `getUserRegistryPath()` abstraction ready. Migrate when testnets upgrade to `r/sys/users`. |

## Key Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-05 | Plugin realms: separate (Option A) | Blast radius isolation, independent audits |
| 2026-03-05 | Notifications: on-chain board-based | No backend, no PII, proven polling pattern |
| 2026-03-05 | Monetisation: phased freemium | Free at launch, soft limits v2.2, on-chain subs v2.3+ |
| 2026-03-05 | Proposals: MsgCall via helpers | gnodaokit `ProposeAddMember()` works with `DoContract` |
| 2026-03-05 | Boards: track HEAD, pin per milestone | Package still evolving (6 active commits) |
| 2026-03-05 | Board naming: `{daoname}_board` suffix | Flat convention, no validation changes needed |
| 2026-03-05 | GnoSwap paths: hardcoded per-chain | Security (no spoofing), same pattern as NETWORKS config |
| 2026-03-05 | Board content: Markdown | Native to Gno Post.Body, rendered by Render() |
| 2026-03-05 | Deploy error: restart from beginning | Realm deploy not idempotent, clean state required |
| 2026-03-05 | Profile: keep on /profile/:addr | Contextual editing, Settings links to it |
| 2026-03-05 | Rate limit: on-chain in realm | Red Team consensus — frontend-only is spoofable |
| 2026-03-05 | Stealth mode: no public issues | Work silently on dev/v2, announce at merge |
| 2026-03-05 | GnoSwap listing: part of v2.0-γ | "List on GnoSwap" button on GRC20 token detail |
| 2026-03-05 | Version: v1.7.x hotfixes, v2.0 is public | Parallel tracks until v2.0 merges |
| 2026-03-07 | Boards: 100% on-chain with gas sponsorship | No hybrid — abstract signing friction from UX |
| 2026-03-07 | $MEMBA token: 10M supply, DAO-controlled mint | 40% treasury, 30% community, 20% core, 10% partnerships |
| 2026-03-07 | MembaDAO candidature: public, 2-member approval | Airdrop 10 $MEMBA on approval, 90-day transfer lock |
| 2026-03-07 | DAO deploy fee: 10 GNOT | Up from 2 GNOT |
| 2026-03-07 | Token creation fee: 2.5% | Down from 5% |
| 2026-03-07 | Validator Service: separate project, ~€200/mo | French VPS provider (Scaleway), Stripe billing |
| 2026-03-07 | NFT metadata: IPFS via nft.storage (free, no backend) | Client-side pinning, CID on-chain |
| 2026-03-07 | Extension Hub: MembaDAO curates "Official" badge | Others listed as "Unofficial / Untrusted" |
| 2026-03-07 | Audio/Video: Jitsi Meet (or OSS P2P E2E) | Self-hosted, embed via iframe |
| 2026-03-07 | FEE_RECIPIENT: Samouraï Coop multisig | `g1pavqfezrge9kgkrkrahqm982yhw5j45v0zw27v` (was founder addr) |
| 2026-03-07 | Re-candidature: increasing GNOT cost | 10 GNOT × past rejections — anti-spam |
| 2026-03-07 | IPFS avatars: save ipfs:// canonical | Gateway-agnostic, resolveAvatarUrl() on display |

## File Index

| File | Purpose |
|------|---------|
| [SESSION_CONVENTIONS.md](SESSION_CONVENTIONS.md) | **Read first** — session startup/end rules |
| [METHODOLOGY.md](METHODOLOGY.md) | Development methodology for v2.1+ |
| [milestones/v2.1a-community/BRIEF.md](milestones/v2.1a-community/BRIEF.md) | Community Foundation scope |
| [milestones/v2.1b-validators/BRIEF.md](milestones/v2.1b-validators/BRIEF.md) | Validators & Notifications scope |
| [milestones/v2.1b-validators/AUDIT.md](milestones/v2.1b-validators/AUDIT.md) | v2.1b dual-round audit results |
| [milestones/v2.1b-validators/HANDOFF.md](milestones/v2.1b-validators/HANDOFF.md) | v2.1b handoff for next agent |
| [milestones/v2.1b-validators/SUMMARY.md](milestones/v2.1b-validators/SUMMARY.md) | v2.1b completion summary |
| [milestones/v2.2a-directory/BRIEF.md](milestones/v2.2a-directory/BRIEF.md) | Organization Directory scope |
| [milestones/v2.2a-directory/HANDOFF.md](milestones/v2.2a-directory/HANDOFF.md) | v2.2a handoff (5 deferred items) |
| [milestones/v2.5-channels/HANDOFF.md](milestones/v2.5-channels/HANDOFF.md) | v2.5 handoff (voice/video, polling) |
| [milestones/v2.5-channels/AUDIT.md](milestones/v2.5-channels/AUDIT.md) | v2.5 audit (13 findings, 12 fixed) |
| [milestones/v2.6-hardening/BRIEF.md](milestones/v2.6-hardening/BRIEF.md) | v2.6 scope & acceptance criteria |
| [milestones/v2.6-hardening/IMPLEMENTATION.md](milestones/v2.6-hardening/IMPLEMENTATION.md) | v2.6 full implementation plan (40+ tasks) |
| [GNOSWAP_SLIPPAGE.md](GNOSWAP_SLIPPAGE.md) | GnoSwap swap execution spec |
| [SENTRY_INTEGRATION.md](SENTRY_INTEGRATION.md) | Sentry integration guide (✅ done) |

### Archived (v2.0)

| File | Purpose |
|------|---------|
| [archive/v2.0-alpha/BRIEF.md](archive/v2.0-alpha/BRIEF.md) | Foundation scope |
| [archive/v2.0-beta/BRIEF.md](archive/v2.0-beta/BRIEF.md) | Board scope |
| [archive/v2.0-gamma/BRIEF.md](archive/v2.0-gamma/BRIEF.md) | Swap scope |
| [archive/v2.0-delta/BRIEF.md](archive/v2.0-delta/BRIEF.md) | Polish scope |
| [archive/v2.0-eta/SUMMARY.md](archive/v2.0-eta/SUMMARY.md) | UX audit results |
| [archive/v2.0-theta/SUMMARY.md](archive/v2.0-theta/SUMMARY.md) | UX polish results |
