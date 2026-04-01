# Freelance Services — Activation Plan

> **Status:** Gated behind `VITE_ENABLE_SERVICES=true`
> **Current code:** `frontend/src/pages/FreelanceServices.tsx` (fully implemented UI)
> **On-chain realm:** `escrowTemplate.ts` generates milestone-based escrow

## Overview

Hire experts with milestone-based escrow contracts on gno.land. DAOs can
post bounties and freelancers can deliver work with automated payment
releases upon milestone completion.

## Prerequisites

1. **Escrow realm deployed** — `contracts/escrow_stub/` exists but is not deployed
   to any network. Needs deployment via samcrew-deployer.
2. **GRC20 integration** — Escrow payments require GRC20 token support (approve + transferFrom).
3. **Dispute resolution** — The escrow template includes arbitration logic, but the
   arbitrator address needs to be configured (likely the DAO itself).

## Implementation Steps

### Phase 1 — Browse Services (enable the flag)
1. Deploy escrow realm to testnet via samcrew-deployer
2. Seed service listings (can be Memba team services initially)
3. Replace mock data in `escrowTemplate.ts` with on-chain queries
4. Set `VITE_ENABLE_SERVICES=true` in production

### Phase 2 — Create & Fund Escrows
1. "Post a Bounty" form (milestone definitions, funding amount, deadline)
2. Escrow funding flow (GRC20 approve + deposit)
3. Milestone submission and review UI
4. Automated payment release on milestone approval

### Phase 3 — DAO Bounty Board
1. DAO-level bounty management (propose bounties via governance)
2. Contributor reputation tracking (completed milestones, ratings)
3. Cross-DAO freelancer discovery

## Test Plan

- [ ] E2E test: services page renders listings
- [ ] Unit tests for escrow realm code generation
- [ ] Integration test: create escrow, fund, complete milestone, release payment
- [ ] Test dispute resolution flow
- [ ] Verify timeout auto-refund behavior

## Rollout Criteria

- [ ] Escrow realm deployed and queryable
- [ ] At least 1 end-to-end escrow lifecycle completed on testnet
- [ ] GRC20 approve/transferFrom working with escrow
- [ ] All existing E2E tests pass with flag enabled
