# Memba v2.x — Master Roadmap

> **Status tracker for all v2.0 milestones. Updated at the end of each session.**
> Last updated: 2026-03-07 (v2.0-θ session)

## Milestone Status

| # | Codename | Phase | Status | Effort | Branch |
|---|----------|-------|--------|--------|--------|
| 1 | **Foundation** | v2.0-α | 🟢 IN PROGRESS | ~14d | `dev/v2` (direct) |
| 2 | **Board** | v2.0-β | 🟢 IN PROGRESS | ~10d | `dev/v2` (direct) |
| 3 | **Swap** | v2.0-γ | 🟢 IN PROGRESS | ~10d | `dev/v2` (direct) |
| 4 | **Polish** | v2.0-δ | 🟢 IN PROGRESS | ~10d | `dev/v2` (direct) |
| 5 | **Audit Sprint** | v2.0-ε | ✅ SHIPPED | ~2d | PR → `dev/v2` |
| 6 | **Sidebar + Sentry** | v2.0-ζ | ✅ SHIPPED | ~1d | PR #69 → `dev/v2` |
| 7 | **UX Audit** | v2.0-η | ✅ SHIPPED | ~1d | PR #70 → `dev/v2` |
| 8 | **UX Polish + Layout** | v2.0-θ | 🟡 IN REVIEW | ~1d | PR #71 → `dev/v2` |

**Total estimated effort**: ~49 development days

## Chain Targets

| Chain | Status | Memba target |
|-------|--------|-------------|
| test11 | ✅ Active | v2.0-α + v2.0-β dev |
| Betanet | 🟡 ~March 12 | v2.0 deployed |
| Mainnet | 🟡 ~April 2026 | v2.0-γ (GnoSwap) live |

## Execution Order

```
v2.0-α Foundation → v2.0-β Board → v2.0-γ Swap → v2.0-δ Polish → merge dev/v2 → main
                                                    ↑
                                    v2.0-ε/ζ/η/θ (incremental polish, shipped)
```
Each milestone MUST be 100% complete before starting the next.

## Next Session Ideas

- **Extensions/Plugins page** — dedicated page showing upcoming extensions with descriptions and status badges (coming soon, available, under development)
- Further v2.0-δ Polish items
- Sentry integration completion
- GnoSwap slippage configuration

## Key Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-07 | Sidebar: `position: fixed` | `sticky` was defeated by grid scroll — `fixed` is viewport-locked |
| 2026-03-07 | Layout: Grid → Flexbox | Accommodates fixed sidebar with `margin-left` compensation |
| 2026-03-07 | Bottom bar: Netlify toolbar | Not an app bug — added 80px footer safeguard padding |
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

## File Index

| File | Purpose |
|------|---------|
| [SESSION_CONVENTIONS.md](SESSION_CONVENTIONS.md) | **Read first** — session startup/end rules |
| [milestones/v2.0-alpha/BRIEF.md](milestones/v2.0-alpha/BRIEF.md) | Foundation scope + acceptance |
| [milestones/v2.0-beta/BRIEF.md](milestones/v2.0-beta/BRIEF.md) | Board scope + acceptance |
| [milestones/v2.0-gamma/BRIEF.md](milestones/v2.0-gamma/BRIEF.md) | Swap scope + acceptance |
| [milestones/v2.0-delta/BRIEF.md](milestones/v2.0-delta/BRIEF.md) | Polish scope + acceptance |
| [milestones/v2.0-eta/SUMMARY.md](milestones/v2.0-eta/SUMMARY.md) | η UX Audit Sprint results |
| [milestones/v2.0-theta/SUMMARY.md](milestones/v2.0-theta/SUMMARY.md) | θ UX Polish + Layout fixes |

