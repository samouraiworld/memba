/**
 * Unit tests for GnoSwap queries + builders.
 */
import { describe, it, expect } from "vitest"
import { parsePoolList, parsePoolDetail } from "./queries"
import {
    buildSwapRouteMsg,
    buildAddLiquidityMsg,
    validateSlippage,
    isSlippageWarning,
    calculateMinOutput,
    DEFAULT_SLIPPAGE,
    SLIPPAGE_WARN,
    SLIPPAGE_MAX,
} from "./builders"

// ── parsePoolList ─────────────────────────────────────────────

describe("parsePoolList", () => {
    const raw = `# GnoSwap Pools

| Pool | Fee | TVL |
|------|-----|-----|
| GNOT/USDC | 0.30% | $1,234,567 |
| GNOT/GNS | 0.30% | $456,789 |
| USDC/ATOM | 0.05% | $789,012 |`

    it("parses all pools from table", () => {
        const pools = parsePoolList(raw)
        expect(pools).toHaveLength(3)
    })

    it("parses token pair", () => {
        const pools = parsePoolList(raw)
        expect(pools[0].token0).toBe("GNOT")
        expect(pools[0].token1).toBe("USDC")
    })

    it("converts fee percentage to basis points", () => {
        const pools = parsePoolList(raw)
        expect(pools[0].feeTier).toBe(3000) // 0.30% → 3000 bps
        expect(pools[2].feeTier).toBe(500)  // 0.05% → 500 bps
    })

    it("preserves TVL with dollar sign", () => {
        const pools = parsePoolList(raw)
        expect(pools[0].tvl).toBe("$1,234,567")
    })

    it("generates path from tokens and fee", () => {
        const pools = parsePoolList(raw)
        expect(pools[0].path).toBe("GNOT_USDC_3000")
    })

    it("returns empty for no matches", () => {
        const pools = parsePoolList("# Empty\n\nNo pools yet.")
        expect(pools).toHaveLength(0)
    })
})

// ── parsePoolDetail ───────────────────────────────────────────

describe("parsePoolDetail", () => {
    const raw = `# GNOT/USDC Pool

* **Fee Tier**: 0.3%
* **TVL**: $1,234,567
* **Token0 Price**: $3.45
* **Token1 Price**: $1.00
* **24h Volume**: $123,456
* **24h Fees**: $370`

    it("parses token pair from title", () => {
        const detail = parsePoolDetail(raw, "GNOT_USDC_3000")
        expect(detail.token0).toBe("GNOT")
        expect(detail.token1).toBe("USDC")
    })

    it("parses fee tier", () => {
        const detail = parsePoolDetail(raw, "test")
        expect(detail.feeTier).toBe(3000)
    })

    it("parses TVL", () => {
        const detail = parsePoolDetail(raw, "test")
        expect(detail.tvl).toBe("$1,234,567")
    })

    it("parses token prices", () => {
        const detail = parsePoolDetail(raw, "test")
        expect(detail.token0Price).toBe("$3.45")
        expect(detail.token1Price).toBe("$1.00")
    })

    it("parses volume and fees", () => {
        const detail = parsePoolDetail(raw, "test")
        expect(detail.volume24h).toBe("$123,456")
        expect(detail.fees24h).toBe("$370")
    })
})

// ── Slippage Validation ───────────────────────────────────────

describe("slippage validation", () => {
    it("exports correct defaults", () => {
        expect(DEFAULT_SLIPPAGE).toBe(0.5)
        expect(SLIPPAGE_WARN).toBe(2.0)
        expect(SLIPPAGE_MAX).toBe(5.0)
    })

    it("validates normal slippage", () => {
        expect(validateSlippage(0.5)).toBeNull()
        expect(validateSlippage(1.0)).toBeNull()
    })

    it("rejects zero slippage", () => {
        expect(validateSlippage(0)).not.toBeNull()
    })

    it("rejects slippage above max", () => {
        expect(validateSlippage(5.1)).not.toBeNull()
        expect(validateSlippage(10)).not.toBeNull()
    })

    it("warns on high slippage", () => {
        expect(isSlippageWarning(2.1)).toBe(true)
        expect(isSlippageWarning(4.0)).toBe(true)
    })

    it("does not warn on normal slippage", () => {
        expect(isSlippageWarning(0.5)).toBe(false)
        expect(isSlippageWarning(2.0)).toBe(false)
    })

    it("does not warn above max (blocked instead)", () => {
        expect(isSlippageWarning(6.0)).toBe(false)
    })
})

// ── calculateMinOutput ────────────────────────────────────────

describe("calculateMinOutput", () => {
    it("applies 0.5% slippage correctly", () => {
        // 1000000 * (10000 - 50) / 10000 = 995000
        expect(calculateMinOutput("1000000", 0.5)).toBe("995000")
    })

    it("applies 1% slippage", () => {
        expect(calculateMinOutput("1000000", 1.0)).toBe("990000")
    })

    it("applies 5% slippage", () => {
        expect(calculateMinOutput("1000000", 5.0)).toBe("950000")
    })

    it("handles small amounts", () => {
        expect(calculateMinOutput("100", 0.5)).toBe("99")
    })

    it("handles very small amounts (rounds down)", () => {
        expect(calculateMinOutput("1", 0.5)).toBe("0")
    })
})

// ── buildSwapRouteMsg ─────────────────────────────────────────

describe("buildSwapRouteMsg", () => {
    const paths = { pool: "gno.land/r/gnoswap/v1/pool", router: "gno.land/r/gnoswap/v1/router", position: "gno.land/r/gnoswap/v1/position" }

    it("builds SwapRoute MsgCall", () => {
        const msg = buildSwapRouteMsg("g1caller", paths, "gno.land/r/demo/gns", "gno.land/r/demo/wugnot", "1000", "990", "GNS_WUGNOT_3000")
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("SwapRoute")
        expect(msg.value.pkg_path).toBe("gno.land/r/gnoswap/v1/router")
        expect(msg.value.args).toEqual(["gno.land/r/demo/gns", "gno.land/r/demo/wugnot", "1000", "990", "GNS_WUGNOT_3000"])
    })
})

// ── buildAddLiquidityMsg ──────────────────────────────────────

describe("buildAddLiquidityMsg", () => {
    const paths = { pool: "gno.land/r/gnoswap/v1/pool", router: "gno.land/r/gnoswap/v1/router", position: "gno.land/r/gnoswap/v1/position" }

    it("builds AddLiquidity Mint MsgCall", () => {
        const msg = buildAddLiquidityMsg("g1caller", paths, "token0", "token1", 3000, "1000", "2000", "-887220", "887220")
        expect(msg.type).toBe("vm/MsgCall")
        expect(msg.value.func).toBe("Mint")
        expect(msg.value.pkg_path).toBe("gno.land/r/gnoswap/v1/position")
        expect(msg.value.args).toEqual(["token0", "token1", "3000", "1000", "2000", "-887220", "887220", "0", "0"])
    })
})
