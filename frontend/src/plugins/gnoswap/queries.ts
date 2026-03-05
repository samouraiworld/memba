/**
 * GnoSwap ABCI Queries — pool list, pool detail, and token prices.
 *
 * Queries GnoSwap realm Render() output for pool data.
 * Uses the same ABCI query pattern as the DAO and Board modules.
 *
 * @module plugins/gnoswap/queries
 */

import { queryRender } from "../../lib/dao/shared"
import type { GnoSwapPaths } from "../../lib/config"

// ── Types ─────────────────────────────────────────────────────

export interface SwapPool {
    /** Pool identifier path (e.g., "gno.land/r/gnoswap/v1/pool:GNOT_USDC_3000"). */
    path: string
    /** Token0 symbol. */
    token0: string
    /** Token1 symbol. */
    token1: string
    /** Fee tier in basis points (e.g., 3000 = 0.3%). */
    feeTier: number
    /** Total value locked (human-readable string). */
    tvl: string
}

export interface PoolDetail {
    path: string
    token0: string
    token1: string
    feeTier: number
    tvl: string
    token0Price: string
    token1Price: string
    volume24h: string
    fees24h: string
}

export interface TokenPrice {
    symbol: string
    priceUsd: string
    priceGnot: string
}

// ── ABCI Queries ──────────────────────────────────────────────

/**
 * Fetch list of GnoSwap pools.
 * Queries Render("") on the pool realm.
 */
export async function getPoolList(rpcUrl: string, paths: GnoSwapPaths): Promise<SwapPool[]> {
    const raw = await queryRender(rpcUrl, paths.pool, "")
    if (!raw) return []
    return parsePoolList(raw)
}

/**
 * Fetch detail for a specific pool.
 * Queries Render("{poolId}") on the pool realm.
 */
export async function getPoolDetail(rpcUrl: string, paths: GnoSwapPaths, poolId: string): Promise<PoolDetail | null> {
    const raw = await queryRender(rpcUrl, paths.pool, poolId)
    if (!raw) return null
    return parsePoolDetail(raw, poolId)
}

/**
 * Check if GnoSwap is available by querying pool realm Render("").
 */
export async function gnoswapAvailable(rpcUrl: string, paths: GnoSwapPaths): Promise<boolean> {
    const raw = await queryRender(rpcUrl, paths.pool, "")
    return raw !== null && !raw.includes("404")
}

// ── Parsers ───────────────────────────────────────────────────

/**
 * Parse pool list from Render output.
 *
 * Expected format:
 * ```
 * # GnoSwap Pools
 *
 * | Pool | Fee | TVL |
 * |------|-----|-----|
 * | GNOT/USDC | 0.3% | $1,234,567 |
 * | GNOT/GNS | 0.3% | $456,789 |
 * ```
 */
export function parsePoolList(raw: string): SwapPool[] {
    const pools: SwapPool[] = []

    // Match table rows: | TOKEN0/TOKEN1 | FEE% | $TVL |
    const rowPattern = /\|\s*([A-Z0-9]+)\/([A-Z0-9]+)\s*\|\s*([\d.]+)%\s*\|\s*\$?([\d,]+)\s*\|/g
    let match
    while ((match = rowPattern.exec(raw)) !== null) {
        const token0 = match[1]
        const token1 = match[2]
        const feePercent = parseFloat(match[3])
        const feeTier = Math.round(feePercent * 10000) // 0.3% → 3000 bps
        const tvl = match[4]
        pools.push({
            path: `${token0}_${token1}_${feeTier}`,
            token0,
            token1,
            feeTier,
            tvl: `$${tvl}`,
        })
    }
    return pools
}

/**
 * Parse pool detail from Render output.
 *
 * Expected format:
 * ```
 * # GNOT/USDC Pool
 *
 * * **Fee Tier**: 0.3%
 * * **TVL**: $1,234,567
 * * **Token0 Price**: $3.45
 * * **Token1 Price**: $1.00
 * * **24h Volume**: $123,456
 * * **24h Fees**: $370
 * ```
 */
export function parsePoolDetail(raw: string, poolId: string): PoolDetail {
    const extract = (label: string): string => {
        const m = raw.match(new RegExp(`\\*\\*${label}\\*\\*:\\s*(.+)`))
        return m ? m[1].trim() : ""
    }

    // Extract token pair from title: "# TOKEN0/TOKEN1 Pool"
    const titleMatch = raw.match(/# ([A-Z0-9]+)\/([A-Z0-9]+)/)
    const token0 = titleMatch ? titleMatch[1] : ""
    const token1 = titleMatch ? titleMatch[2] : ""

    const feeStr = extract("Fee Tier")
    const feePercent = parseFloat(feeStr) || 0
    const feeTier = Math.round(feePercent * 10000)

    return {
        path: poolId,
        token0,
        token1,
        feeTier,
        tvl: extract("TVL"),
        token0Price: extract("Token0 Price"),
        token1Price: extract("Token1 Price"),
        volume24h: extract("24h Volume"),
        fees24h: extract("24h Fees"),
    }
}
