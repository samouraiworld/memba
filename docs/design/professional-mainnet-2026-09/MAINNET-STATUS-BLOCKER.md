# Mainnet proposal status: reproducible rollout blocker

**Update 2026-09-15:** a separate fix is in review in [draft PR #1199](https://github.com/samouraiworld/memba/pull/1199), head `f2363775`. It addresses both status extraction and the GovDAO-specific terminal lifecycle described below. The presentation branches remain unchanged.

Observed during read-only design verification on 2026-09-14. This finding predates the professional preview: the unchanged pilot reader at `a3f8559b` reproduces it. No wallet was connected and no transaction was submitted.

## Evidence

The configured public RPC, `https://rpc.gno.land:443`, reported `node_info.network = gnoland-1` and height **47293**. A JSON-RPC `abci_query` with path `vm/qrender` and the base64-encoded argument `gno.land/r/gov/dao:4` returned a description containing `bank:p:restricted_denoms`, followed by this realm-generated status line:

```text
- **PROPOSAL HAS BEEN ACCEPTED**
```

The overview displays the proposal as passed / awaiting execution. The detail page displays ACTIVE in both the professional preview and the unchanged reader.

## Confirmed parser mechanism

In `frontend/src/lib/dao/proposals.ts`, `getProposalDetail` scans the complete render with:

```ts
/(?:PROPOSAL HAS BEEN\s+)?(\w+ED|ACTIVE)/i
```

Running that exact expression against the captured public render returns **restricted**, from the description, before reaching the authoritative ACCEPTED line. `normalizeStatus` then defaults this unrecognized token to `open`. The fallback `Status:` expression never runs because the earlier match is truthy.

This also explains why generic fixtures with status-first text pass while the actual realm render fails. The current presentation tests validate display/state behavior; they do not certify the existing parser against every realm dialect.

## Separate implementation scope

Fix status extraction against the realm-generated structure, not arbitrary words in user-authored titles/descriptions/action bodies. Preserve existing dialect handling and create regression fixtures from the captured shape before changing the parser. Do not make the shared status normalizer treat arbitrary words ending in “ed” as terminal states.

Required regressions:

- ACCEPTED after a description containing `restricted_denoms` parses as executed for canonical/versioned GovDAO (the lifecycle correction below supersedes the initial passed expectation).
- Words such as accepted/rejected/executed/active inside titles, descriptions or action bodies cannot override the genuine realm status.
- Open, accepted, denied/rejected and executed cases remain correct across supported GovDAO, basedao and daokit formats.
- Overview and detail agree; member/archive restrictions and existing vote/execute message payloads stay intact.
- Verify the live realm read again without connecting a wallet; test transaction-control consequences with mocks and a non-production environment.

Treat this as a mainnet rollout gate. It is deliberately not fixed inside the presentation PR because the resulting status controls transaction eligibility. The broader parser, source-completeness and action-extraction contract needs its own review.

## Deployed lifecycle correction — 2026-09-15

The fresh public read confirmed gnoland-1 at block **52365** and reproduced
the same proposal #4 render. A subsequent read-only `vm/qfile` of
`gno.land/r/gov/dao/impl/v0/govdao.gno` exposed a second pre-existing issue:
GovDAO's ACCEPTED is already terminal, unlike basedao/daokit's Passed state.
`PreExecuteProposal` rejects Accepted or Denied with “proposal already
executed”; a successful acceptance sets Accepted, and execution errors clear
Accepted and set Denied.

Therefore simply changing detail ACTIVE to PASSED is insufficient. The fix
reads generated status fields and maps ACCEPTED to `executed` in canonical /
versioned GovDAO markdown list and detail reads. Generated Memba template status footers remain supported. Other realms, JSON endpoints,
and basedao/daokit tables retain their status contracts. The shared normalizer
and transaction builders are unchanged. A title containing `Status: REJECTED`
cannot override the generated overview Status line.

The isolated port-5197 browser now displays **EXECUTED** for the live proposal
without connecting a wallet. Tests pass the actual parser into ProposalView:
accepted GovDAO offers no vote or repeat-execute control; legacy passed
proposals retain execution, and member/archive/disconnected restrictions
and message payloads remain intact under mocked broadcasts.

**Validation:** 415 targeted checks across 20 files, lint, production build,
attribution scan and diff checks passed locally. Final-head CI passed: **5,029 unit tests, 229 Chromium checks and 58 browser guardrails** (15 unit and 7 Chromium skips). Both Node 20/22, backend, security and build lanes are green. Exact evidence is tracked in TASK-LEDGER.md and PR #1199.

**Rollout:** fix is review-only, unmerged. Integrate it into the design stack
before mainnet release and re-run the combined preview checks. Unknown/missing
render formats still use the existing open fallback. Inferring execution
readiness for still-open GovDAO proposals, threshold completeness, arbitrary
realm authenticity and other action metadata remain separate feature/parser
work; this patch does not claim to complete mainnet capability validation.
