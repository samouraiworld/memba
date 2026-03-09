/**
 * GnoSwap MsgCall Builders — SwapRoute and AddLiquidity.
 *
 * These builders create Amino MsgCall messages for GnoSwap contract calls.
 * All swap/liquidity operations from DAO treasuries must go through
 * governance proposals, never direct execution.
 *
 * @module plugins/gnoswap/builders
 */

import type { AminoMsg } from "../../lib/grc20"
import type { GnoSwapPaths } from "../../lib/config"

// ── Slippage Validation ───────────────────────────────────────

/** Default slippage tolerance (0.5%). */
export const DEFAULT_SLIPPAGE = 0.5

/** Warning threshold for slippage (>2% triggers UI warning). */
export const SLIPPAGE_WARN = 2.0

/** Maximum allowed slippage (>5% is blocked). */
export const SLIPPAGE_MAX = 5.0

/** Validate slippage value. Returns error string or null if valid. */
export function validateSlippage(slippage: number): string | null {
    if (slippage <= 0) return "Slippage must be greater than 0%"
    if (slippage > SLIPPAGE_MAX) return `Slippage cannot exceed ${SLIPPAGE_MAX}%`
    return null
}

/** Check if slippage triggers a warning (>2% but still allowed). */
export function isSlippageWarning(slippage: number): boolean {
    return slippage > SLIPPAGE_WARN && slippage <= SLIPPAGE_MAX
}

/**
 * Calculate minimum output amount accounting for slippage.
 * @param amountOut — expected output amount (as string)
 * @param slippage — slippage tolerance in percent (e.g., 0.5)
 */
export function calculateMinOutput(amountOut: string, slippage: number): string {
    const amount = BigInt(amountOut)
    // minOut = amount * (100 - slippage) / 100, using integer math
    const slippageBps = Math.round(slippage * 100) // 0.5% → 50 bps
    const minOut = (amount * BigInt(10000 - slippageBps)) / BigInt(10000)
    return minOut.toString()
}

// ── MsgCall Builders ──────────────────────────────────────────

/**
 * Build SwapRoute MsgCall for GnoSwap router.
 *
 * @param caller — wallet address executing the swap
 * @param paths — GnoSwap realm paths for the active chain
 * @param tokenIn — input token realm path (e.g., "gno.land/r/demo/gns")
 * @param tokenOut — output token realm path
 * @param amountIn — input amount (as string, in token's smallest unit)
 * @param minAmountOut — minimum output after slippage
 * @param route — route path string (pool IDs separated by ",")
 */
export function buildSwapRouteMsg(
    caller: string,
    paths: GnoSwapPaths,
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    minAmountOut: string,
    route: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: paths.router,
            func: "SwapRoute",
            args: [tokenIn, tokenOut, amountIn, minAmountOut, route],
        },
    }
}

/**
 * Build AddLiquidity MsgCall for GnoSwap position manager.
 *
 * @param caller — wallet address adding liquidity
 * @param paths — GnoSwap realm paths for the active chain
 * @param token0 — first token realm path
 * @param token1 — second token realm path
 * @param feeTier — fee tier in basis points (e.g., 3000)
 * @param amount0 — amount of token0 to add
 * @param amount1 — amount of token1 to add
 * @param tickLower — lower tick of the price range
 * @param tickUpper — upper tick of the price range
 */
export function buildAddLiquidityMsg(
    caller: string,
    paths: GnoSwapPaths,
    token0: string,
    token1: string,
    feeTier: number,
    amount0: string,
    amount1: string,
    tickLower: string,
    tickUpper: string,
): AminoMsg {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: paths.position,
            func: "Mint",
            args: [token0, token1, String(feeTier), amount0, amount1, tickLower, tickUpper, "0", "0"],
        },
    }
}
