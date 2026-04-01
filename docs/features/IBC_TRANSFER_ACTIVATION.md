# IBC Transfer Integration — Activation Plan

> **Status:** Gated as "Coming Soon"
> **Blocked by:** Gno IBC2 production readiness, gnoland1 relaunch
> **Feature flag:** N/A (requires code implementation, not just a toggle)

## Overview

Enable cross-chain GRC20 token transfers via the IBC transfer application
(`gno.land/r/aib/ibc/apps/transfer`). This would allow Memba DAOs to send and
receive tokens from Cosmos Hub, Osmosis, and other IBC-connected chains.

## Prerequisites

1. **Gno IBC2 merged and stable on betanet** — The GRC20 transfer app is merged
   on master ([gno-realms README](https://github.com/allinbits/gno-realms/blob/master/gno.land/r/aib/ibc/apps/transfer/README.md))
   but not yet deployed to a production network.
2. **gnoland1 relaunched** — Chain is currently halted (consensus bug under investigation).
3. **Adena wallet IBC support** — Wallet must support IBC MsgTransfer signing.
4. **Relayer infrastructure** — At least one relayer connecting gnoland1 to a Cosmos chain.

## Implementation Steps

### Phase 1 — Read-Only IBC Status
1. Add IBC balance query to Treasury page (show IBC denoms alongside native GNOT/GRC20)
2. Display transfer channel status (open/closed) from chain state
3. Add "IBC Transfers" info badge on TokenView page

### Phase 2 — Send Transfers
1. Add `MsgTransfer` builder in `frontend/src/lib/ibc.ts`
2. Create IBC transfer form component (destination chain, channel, recipient, amount, timeout)
3. Integrate with Adena wallet signing flow
4. Add transfer history view (query transfer packets from chain)

### Phase 3 — DAO Treasury IBC
1. Enable multisig-signed IBC transfers from DAO treasuries
2. Add IBC transfer as a proposal type in `ProposeDAO.tsx`
3. Cross-chain asset tracking in DAO analytics

## Test Plan

- [ ] Unit tests for MsgTransfer builder with edge cases (timeout, invalid channels)
- [ ] E2E test with mock IBC channel (if test infrastructure available)
- [ ] Manual test on testnet with active relayer
- [ ] Verify Adena signing flow for IBC messages
- [ ] Verify rollback behavior on transfer timeout

## Rollout Criteria

- [ ] GRC20 transfer app deployed on target network
- [ ] At least 1 active relayer channel verified
- [ ] Adena wallet supports IBC MsgTransfer
- [ ] All unit + integration tests pass
- [ ] Security review of MsgTransfer construction (no injection in channel/port IDs)
