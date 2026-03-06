# GnoSwap Slippage Tolerance — Implementation Guide

> **Status:** Planned (pre-mainnet)  
> **Priority:** Medium  
> **Effort:** ~2 hours  
> **Branch:** `dev/v2`  
> **Prerequisite:** GnoSwap contracts deployed on active chain

## Overview

Add slippage tolerance to the GnoSwap plugin so users can execute swaps with protection against price movement between quote and execution.

## Current State

The GnoSwap plugin (`frontend/src/plugins/gnoswap/`) is **read-only**:
- `SwapView.tsx` — shows pool data (token pairs, TVL, prices)
- `GnoSwapPlugin.tsx` — registers the plugin with the PluginLoader
- No transactional swap execution exists yet

## Implementation Steps

### 1. Add Slippage State to `SwapView.tsx`

```tsx
const [slippage, setSlippage] = useState(0.5) // 0.5% default
const SLIPPAGE_OPTIONS = [0.1, 0.5, 1.0] // quick-select buttons
```

### 2. Slippage UI Component

```tsx
function SlippageSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    return (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "#888" }}>Slippage:</span>
            {[0.1, 0.5, 1.0].map(s => (
                <button
                    key={s}
                    onClick={() => onChange(s)}
                    className={value === s ? "k-btn-primary" : "k-btn-secondary"}
                    style={{ fontSize: 11, padding: "4px 8px" }}
                >
                    {s}%
                </button>
            ))}
            <input
                type="number"
                value={value}
                onChange={e => onChange(Math.max(0.01, Math.min(50, parseFloat(e.target.value) || 0.5)))}
                style={{ width: 60, fontSize: 11 }}
                step="0.1"
                min="0.01"
                max="50"
            />
        </div>
    )
}
```

### 3. Calculate `minAmountOut`

```ts
// In a new file: plugins/gnoswap/slippage.ts
export function calculateMinAmountOut(
    expectedOut: bigint,
    slippagePct: number,
): bigint {
    // slippagePct is e.g. 0.5 for 0.5%
    const basisPoints = BigInt(Math.round(slippagePct * 100)) // 50 for 0.5%
    const minOut = expectedOut - (expectedOut * basisPoints) / 10000n
    return minOut > 0n ? minOut : 1n // never allow 0
}
```

### 4. Build Swap MsgCall

```ts
// In plugins/gnoswap/builders.ts
import { calculateMinAmountOut } from "./slippage"

export function buildSwapMsg(
    caller: string,
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    expectedOut: bigint,
    slippagePct: number,
): AminoMsg {
    const minOut = calculateMinAmountOut(expectedOut, slippagePct)
    return {
        type: "/vm.m_call",
        value: {
            caller,
            send: "",
            pkg_path: GNOSWAP_ROUTER_PATH,
            func: "SwapRoute",
            args: [
                tokenIn,
                tokenOut,
                amountIn.toString(),
                minOut.toString(),       // slippage-protected minimum
                "EXACT_IN",
            ],
        },
    }
}
```

### 5. Wire to `doContractBroadcast`

The existing `doContractBroadcast()` in `grc20.ts` already:
- ✅ Checks RPC trust before broadcast
- ✅ Handles Adena signing
- ✅ Returns `{ hash }` or throws

Just pass the built swap message through it.

### 6. Warning States

Display warnings when:
- `slippage < 0.1%` → "Transaction may fail due to low slippage"
- `slippage > 5%` → "High slippage — you may receive significantly fewer tokens"
- `price impact > 3%` → "Large trade — significant price impact expected"

### 7. Unit Tests

```ts
// plugins/gnoswap/slippage.test.ts
describe("calculateMinAmountOut", () => {
    test("0.5% slippage", () => {
        expect(calculateMinAmountOut(10000n, 0.5)).toBe(9950n)
    })
    test("1% slippage", () => {
        expect(calculateMinAmountOut(10000n, 1.0)).toBe(9900n)
    })
    test("never returns 0", () => {
        expect(calculateMinAmountOut(1n, 99)).toBe(1n)
    })
})
```

### 8. Verification Checklist

- [ ] Slippage selector renders with 0.1% / 0.5% / 1.0% buttons
- [ ] Custom slippage input works (clamped 0.01–50%)
- [ ] `minAmountOut` calculation is correct
- [ ] Swap blocked if wallet RPC is untrusted
- [ ] Warning shown for extreme slippage values
- [ ] Unit tests pass
- [ ] E2E test: slippage selector visible on swap page

## Dependencies

- GnoSwap contracts must be deployed on the active chain
- Currently only `test11` has paths configured in `config.ts`
- `staging` and `portal-loop` have empty GnoSwap paths
