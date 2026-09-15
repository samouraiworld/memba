# Governance presentation preview

Status: in progress, isolated on feat/professional-governance, stacked on the shell and brand preview (62566f17). Latest autonomous continuation authorizes this presentation slice.

## Ownership and boundaries

This work owns the default-off governance route predicate, DAO overview and proposal presentation, scoped stylesheet, fixture browser tests and review evidence. Existing transaction builders, signing handlers, permissions, realm deployment, polling, treasury routes and capability gates remain owned by their existing feature flows. No production activation or merge.

## Review goals

- Use available desktop width while retaining readable proposal text.
- Separate open voting from passed proposals awaiting execution.
- Provide real links, searchable proposal lists and visible empty/error/loading states.
- Apply the approved System / Light / true Black direction.
- Preserve legacy rendering when the flag is off; exclude create, members, treasury, channels and plugin routes.

## Agent handoff method

One owner edits shared page integration. Keep changes on this worktree; do not switch or reset the shared checkout. Verify route exclusions, fixture-based browser behavior, lint and production build before a draft PR. Track limitations and evidence here; integrate parent branches before eventual merge. Read this file and git status before resuming.

## Implementation

- `VITE_ENABLE_PRO_GOVERNANCE=true` independently enables known-network DAO overview and numeric proposal-detail routes. `proGovernance.ts` reuses the existing DAO slug parser. Legacy tilde links redirect normally before preview rendering. Treasury, creation, members, channels and plugins are excluded.
- Route-scoped `governance-professional.css` uses a 1600px maximum workspace, 16–48px horizontal gutters, 1.55:1 reading/voting columns above 1150px, and a single column below. Standard Black surfaces are #000; borders and typography provide hierarchy. Light cards are white.
- `ProDAOProposals` contains only ephemeral search/status state and links. Changing DAO resets the list component. No new requests, sorting engine, local persistence or capability rules.
- `ProProposalVotes` displays reported counts and actual available configuration. It does not substitute percentages for counts, fabricate a 60% threshold, or predict proposal passage. Empty totals have explicit ambiguity copy.
- Existing proposal vote/execute handlers, message builders, polling, caches, archive/member gates and confirmation flow remain in place. JSX wrappers use `display: contents` when the preview is off. The health-score calculation is unchanged; its manual memo was removed because the React compiler rejected retaining it across the preview branches.
- DAO summaries separate open proposals from passed proposals, move voting power into a disclosure, and omit experimental health/non-voter estimates from primary UI. The existing analyst feature keeps its original flag and behavior.
- Whole-row member links are confined to the overview preview. The original MemberCard and full member screen remain intact.

## Local reproduction

Use this worktree's own installed dependencies. Do not symlink another running worktree's node_modules or Vite cache.

```sh
cd frontend
VITE_ENABLE_PRO_UI=true VITE_ENABLE_PRO_SHELL=true VITE_ENABLE_PRO_GOVERNANCE=true npm run dev -- --host 127.0.0.1 --port 5194 --strictPort
```

Preview routes: `/mainnet/dao/gno.land/r/gov/dao`, then a proposal link. The existing mainnet capability notice is preserved. The real mainnet DAO loaded in a read-only browser review; no wallet was connected and no transaction was sent.

Tests use a separate strict-port server on 5195 and offline fixtures under `e2e/helpers/proGovernanceFixture.ts`. Fixtures never enter application source or production bundles.

## Verification

- Targeted route, vote-summary and legacy-card tests: 35 passed.
- Proposal transaction parity: 10 passed (preview on/off, confirmation/cancel, exact vote/execute messages, membership, archive and disconnected readers). Broadcast is mocked; no real transaction.
- Four-browser governance suite: see final CI evidence below. Covers Chromium, Firefox, iPhone WebKit and Pixel, 320–1920px, populated members, search/filter/history, keyboard links, missing proposals/retry, failed RPCs, completed-state copy and route exclusions.
- Scoped axe checks cover the overview, member list, proposal list and full proposal reader in Light/Black. This is not a claim of full-product WCAG certification.
- Production build and lint must pass before publishing the draft.

## Rollback and rollout gates

Keep `VITE_ENABLE_PRO_GOVERNANCE` absent or false to retain the existing presentation. Shell and Validators remain separately controlled. No deployed realm/package, treasury kill-switch, authentication model, wallet code or production branding metadata changed. Integrate parent PRs in order and refresh against current main before merge; do not cherry-pick this stage without its theme/shell prerequisites.

Remaining gates: manual screen-reader and physical-device review, connected-wallet visual review on a non-production network, long tier/role data, and review of parser ambiguity/completeness before any further “needs my vote” or turnout inference. No production merge or deployment is authorized by the preview.

## Local verification result

Lint and the default production build passed. The full governance suite passed 42 browser cases; after the final #000 surface adjustment, all 8 affected desktop/mobile visual and accessibility cases passed again. CI repeats the complete suite on the published head. The existing Vite large-chunk warning remains; no dependency or bundler threshold was changed.

## Known mainnet rollout blocker

Live read-only inspection found that GovDAO proposal #4 appears as **Awaiting execution** in the overview but **ACTIVE** in the detail reader. The unchanged reader at pilot head `a3f8559b` reproduces the same ACTIVE state, so this is not introduced by the professional presentation. Its legacy voting summary also substitutes a 60% threshold where the new reader correctly reports the absent configuration as unavailable.

The status mismatch must be resolved in a separately owned read/parser change before mainnet rollout. The existing `getProposalDetail` status parser scans broad text before its explicit Status fallback; investigate that parsing contract against actual realm render output, without changing signing eligibility incidentally. This slice preserves the existing transaction behavior and does not claim the live proposal is actionable. No wallet was connected during comparison.
