/**
 * blockTimeRpc — resolve a gno block height to its EXACT wall-clock time via RPC.
 *
 * The reviews realm (`memba_reviews_v1`) stores `CreatedAt` / `EditedAt` as a *block
 * height* (`runtime.ChainHeight()`), NOT a Unix timestamp. To show an accurate human
 * date we resolve the block's `header.time` via the Tendermint RPC `/block?height=N`
 * endpoint (vs. the estimation in ./blockTime.ts, which is only "~approximate").
 *
 * Block times are immutable once mined, so resolved heights are cached permanently.
 * In-flight requests are deduped (single-flight) so N review cards sharing a height
 * fire ONE request. Transient network failures are NOT cached, so a later retry works.
 */
import { resilientRpcCall } from "./rpcFallback"

// height → epoch ms (null = resolved but unparseable; absence = not yet / transient fail)
const cache = new Map<number, number | null>()
const inFlight = new Map<number, Promise<number | null>>()

/** Parse a Tendermint `/block` result → epoch ms, or null. Exported for tests. */
export function blockResultToEpochMs(result: unknown): number | null {
    const time = (result as { block?: { header?: { time?: unknown } } } | null)?.block?.header?.time
    if (typeof time !== "string") return null
    const ms = Date.parse(time)
    return Number.isNaN(ms) ? null : ms
}

/**
 * Resolve one block height → epoch ms (cached + single-flight).
 * Returns null for height < 1 or when the block can't be resolved.
 */
export async function fetchBlockTime(height: number): Promise<number | null> {
    if (!height || height < 1) return null
    if (cache.has(height)) return cache.get(height) ?? null
    const existing = inFlight.get(height)
    if (existing) return existing

    const p = (async () => {
        try {
            const result = await resilientRpcCall("/block", { height: String(height) })
            const ms = blockResultToEpochMs(result)
            cache.set(height, ms) // cache success (incl. a parsed-but-null block)
            return ms
        } catch {
            return null // transient — do NOT cache, allow a later retry
        } finally {
            inFlight.delete(height)
        }
    })()
    inFlight.set(height, p)
    return p
}

/** Resolve many heights at once (deduped). Returns only successfully-resolved entries. */
export async function fetchBlockTimes(heights: number[]): Promise<Map<number, number>> {
    const distinct = [...new Set(heights.filter((h) => h && h >= 1))]
    const out = new Map<number, number>()
    await Promise.all(
        distinct.map(async (h) => {
            const ms = await fetchBlockTime(h)
            if (ms != null) out.set(h, ms)
        }),
    )
    return out
}

/** Test-only: clear the module caches. */
export function __resetBlockTimeRpcCache(): void {
    cache.clear()
    inFlight.clear()
}
