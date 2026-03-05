# v2.0-γ Swap — Milestone Brief

> **Read `SESSION_CONVENTIONS.md` before starting this milestone.**

## Scope

| Feature | Branch | Priority |
|---------|--------|----------|
| GnoSwap ABCI queries + MsgCall builders | `feat/v2.0-gamma/gnoswap-queries` | 🟢 |
| Swap proposal UI | `feat/v2.0-gamma/gnoswap-proposal` | 🟢 |
| GRC20 "List on GnoSwap" button | `feat/v2.0-gamma/gnoswap-listing` | 🟢 |
| Add Liquidity proposal | (same branch as swap) | 🟢 |
| Treasury "Swap" tab | (same branch as proposal) | 🟡 |

## Acceptance Criteria

- [ ] `plugins/gnoswap/queries.ts` — pool list, pool detail, token prices via ABCI
- [ ] `plugins/gnoswap/builders.ts` — `SwapRoute` + `AddLiquidity` MsgCall builders
- [ ] Swap proposal UI: token pair selector, amount, slippage (default 0.5%, warn >2%, block >5%)
- [ ] Add Liquidity proposal UI: token pair, amount, price range
- [ ] Treasury page "Swap" tab visible for DAOs with GnoSwap extension
- [ ] GRC20 Token detail page: "List on GnoSwap" button (opens swap proposal wizard)
- [ ] GnoSwap realm paths hardcoded per-chain in `config.ts`
- [ ] E2E tests with mock GnoSwap responses
- [ ] 11-perspective cross-audit documented

## Key Technical Details

### GnoSwap config (hardcoded per chain)
```typescript
export const GNOSWAP_PATHS = {
    test11: { pool: "gnoswap/v1/pool", router: "gnoswap/v1/router", position: "gnoswap/v1/position" },
    betanet: { pool: "...", router: "...", position: "..." },
    mainnet: { pool: "...", router: "...", position: "..." },
}
```

### DoContract for GnoSwap SwapRoute
```typescript
window.adena.DoContract({
    messages: [{
        type: "/vm.m_call",
        value: {
            caller: daoAddress,
            send: "",
            pkg_path: GNOSWAP_PATHS[chain].router,
            func: "SwapRoute",
            args: [tokenIn, tokenOut, amountIn, minAmountOut, route],
        }
    }],
    gasFee: 2000000, gasWanted: 20000000,
})
```

> Note: GnoSwap swaps from DAO treasury must go through a governance proposal, never direct execution.

## Estimated Effort
~10 development days

## Dependencies
- v2.0-α + v2.0-β merged
- GnoSwap contracts deployed on target chain (test11 for dev, mainnet for production)
- GnoSwap contract ABI (from `gnoswap-labs/gnoswap` repo)

## Chain Timeline Impact
- **test11**: build + test with mock/test pools
- **Betanet**: test with deployed GnoSwap contracts
- **Mainnet**: go live with real liquidity
