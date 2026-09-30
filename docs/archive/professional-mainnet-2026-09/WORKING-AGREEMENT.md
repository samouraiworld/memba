# Safe collaboration proposal

**Status: adopted for the authorized pilot (2026-09-14).** The confirmed direction is in [DECISIONS.md](DECISIONS.md), and a conditional [implementation-plan proposal](IMPLEMENTATION-PLAN.md) now exists. The user has now authorized beginning P0–P5; production release remains a separate gate.

The user asked to agree on art direction and UX changes first. Detailed PR sequencing, estimates and implementation ownership come after that discussion. The purpose of this document is to make the current audit safe and provide a concrete process to approve later.

## Current isolation

- Repository: Memba only.
- Branch: `docs/professional-design-audit`.
- Worktree: `Memba-worktrees/professional-design-audit`, a checkout of the Memba repository using the existing sibling-worktree convention.
- Base snapshot: `e20d261b` from the locally available `origin/main` reference.
- Allowed changes this round: this design-study directory and its concept assets.
- Shared `/Memba` checkout and other worktrees remain available to their sessions.
- No application source, dependency, network configuration, contract, deployment, or active feature flag is changed by this study.

## Decision gates

| Gate | Reviewable result | Decision needed |
|---|---|---|
| Audit discussion | Findings, coverage limits and existing foundations | Agree on problem priorities and intended audience |
| Art direction | A/B/C plus examples of dense desktop and focused mobile UI | Choose primary direction, theme policy and brand boundaries |
| UX validation | Refined validators, DAO/proposal and transaction review designs, including error and availability states | Approve hierarchy, navigation, status semantics and preserved capabilities |
| Implementation-plan proposal | Dependency map, bounded PRs, file ownership, preview/test/rollback criteria and parallel-session coordination | Approve the actual development strategy |
| Implementation and release | Small reviewed changes with evidence | Normal PR/release process; no automatic merge from this study |

## Proposed long-running work model

Avoid a single months-long rewrite branch. Keep decisions and approved references versioned, then use short feature branches from the current mainline for independently reviewable changes. Separate the design-program record from deployable code. An integration preview is useful; it should not become the only place compatible changes exist.

Start with additive presentation seams and preserved interfaces. Route-by-route adoption or a presentation-only preview switch can keep work reviewable, but a specific mechanism must be selected in the later implementation plan. A UI preview flag must never enable a contract capability, alter authorization or change the active network.

Give each task one owner, named files and a bounded outcome. Shared shell, router, navigation manifest and token files need a single coordinating owner during an active change. Feature sessions can continue on their own worktrees; avoid concurrent edits to those shared files. No agent should reset, overwrite or revert another session's work.

## Suggested task packet for future agents

Every approved development task should carry:

1. Decision/reference ID and screenshot or design frame version.
2. Exact base commit, branch and worktree.
3. Owned files and any shared-file dependency requiring coordination.
4. User-visible outcome and explicit non-goals.
5. Inputs/outputs that must stay compatible: routes, query parameters, context props, transaction payloads and capability gates.
6. Applicable role/network/state fixtures and acceptance criteria.
7. Required validation, including both themes and relevant viewport/keyboard checks.
8. Rollback mechanism and handoff record: changed paths, commit/PR, tests, remaining gaps, next owner.

This is a methodology for future work; it does not start background agents, schedules, automations or new tasks.

## Compatibility boundaries

UI work should preserve network URLs and legacy redirects; exact amounts and unit conversions; wallet/auth/activation boundaries; signer thresholds; transaction/sign-document construction; contract addresses and deployment gates; backend APIs, query identity and persistence; moderation/privacy behavior; supported export and offline workflows.

A visually cleaner review must not skip an existing confirmation, mask an unknown amount, imply finality early, or retry a financial action blindly. If a proposal requires behavior or data-model changes, identify and review those separately from styling.

Do not promise zero regressions. Make risk bounded and visible through scoped diffs, stable fixtures, previews and rollback.

## Proposed verification policy

Use existing component/unit tests where behavior is touched and preserve current route, network-resolution, signing, amount and capability coverage. Add targeted tests for new behavior; do not snapshot every CSS declaration. Use visual comparisons for shared shell and migrated pages at mobile, tablet, laptop and wide-desktop widths in both themes, plus keyboard and reduced-motion checks where relevant.

Suggested validation matrix: 390 px mobile, 768 px tablet, 1,440 px laptop/desktop, 1,920 px wide desktop; also 320 CSS px reflow and text zoom. Roles: visitor, wallet-connected but unauthenticated, authenticated non-member, member, signer, admin. States: loading, empty, current, stale, partial failure, unavailable network/capability, rejected signature, pending and confirmed transaction.

Transaction-path changes require non-production fixtures and payload/permission regression evidence. A visual-only change should not require deploying realms. Rollback should be a bounded code revert or previously approved presentation switch, not a chain migration.

## Conflict protocol

Record active tasks and their file ownership in the design-program tracking document selected during planning. Before each change, check branch/worktree status and the latest shared contracts. Rebase only the task's own branch. If a feature session changes an owned component or data contract, pause that overlapping edit, record the dependency, and adapt the design task to the new baseline. Keep non-overlapping work moving.

The implementation-plan proposal now follows the confirmed direction, with detailed proof approval as its first gate. This agreement remains the collaboration framework; implementation authorization is recorded in D-08 and does not include feature activation.
