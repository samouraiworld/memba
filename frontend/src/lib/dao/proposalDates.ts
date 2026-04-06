/**
 * proposalDates — Hybrid proposal timestamp resolution.
 *
 * Strategy:
 * 1. If `createdAt` ISO string is available (from Render parsing) → use it (exact).
 * 2. If `createdAtBlock` is available → estimate via blockTime.ts (~approximate).
 * 3. Fallback: try tx-indexer `tx_search` for the Propose transaction → exact timestamp.
 *
 * All results are cached in sessionStorage (10-minute TTL).
 *
 * @module lib/dao/proposalDates
 */

import { estimateBlockDate, formatProposalDate } from "../blockTime"
import { resilientRpcCall } from "../rpcFallback"

// ── Types ─────────────────────────────────────────────────────

export interface ProposalTimestamp {
    /** Estimated or exact creation date. */
    date: Date
    /** Block height at creation (if known). */
    block: number | null
    /** Whether this is an exact timestamp (from indexer) or estimated. */
    exact: boolean
    /** Formatted date label for display ("~Apr 3, 2026 at 14:32" or "Apr 3, 2026 at 14:32"). */
    label: string
}

// ── Cache ─────────────────────────────────────────────────────

const CACHE_TTL = 10 * 60 * 1000 // 10 minutes
const CACHE_PREFIX = "memba_propdate_"

interface CacheEntry {
    ts: number
    data: { dateMs: number; block: number | null; exact: boolean }
}

function getCached(realmPath: string, proposalId: number): CacheEntry["data"] | null {
    try {
        const key = `${CACHE_PREFIX}${realmPath}:${proposalId}`
        const raw = sessionStorage.getItem(key)
        if (!raw) return null
        const entry = JSON.parse(raw) as CacheEntry
        if (
            typeof entry !== "object" || entry === null ||
            typeof entry.ts !== "number" || !entry.data
        ) {
            sessionStorage.removeItem(key)
            return null
        }
        if (Date.now() - entry.ts > CACHE_TTL) {
            sessionStorage.removeItem(key)
            return null
        }
        return entry.data
    } catch { return null }
}

function setCache(realmPath: string, proposalId: number, data: CacheEntry["data"]): void {
    try {
        const key = `${CACHE_PREFIX}${realmPath}:${proposalId}`
        sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }))
    } catch { /* quota */ }
}

// ── Current Block Fetching ────────────────────────────────────

let _currentBlockCache: { block: number; ts: number } | null = null
const BLOCK_CACHE_TTL = 30_000 // 30s

/**
 * Fetch the latest block height from the RPC status endpoint.
 * Cached for 30 seconds. Used for block-to-time estimation.
 */
export async function getCurrentBlock(): Promise<number> {
    if (_currentBlockCache && (Date.now() - _currentBlockCache.ts) < BLOCK_CACHE_TTL) {
        return _currentBlockCache.block
    }

    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await resilientRpcCall("status") as any
        const height = parseInt(result?.sync_info?.latest_block_height || "0", 10)
        if (height > 0) {
            _currentBlockCache = { block: height, ts: Date.now() }
            return height
        }
    } catch { /* non-blocking */ }

    return _currentBlockCache?.block || 0
}

// ── tx-indexer Search ─────────────────────────────────────────

/**
 * Try to find the proposal creation transaction via tx_search.
 * Returns the block time (exact timestamp) if found.
 *
 * This is a best-effort approach — indexer may be unavailable
 * (e.g. testnet12 is currently down).
 */
async function searchProposalTx(
    realmPath: string,
    _proposalId: number,
): Promise<{ date: Date; block: number } | null> {
    try {
        // Search for MsgCall transactions to this realm's Propose function
        const query = `"message.action='MsgCall' AND message.module='${realmPath}'"`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await resilientRpcCall("tx_search", {
            query,
            per_page: "5",
            order_by: "\"desc\"",
        }) as any

        const txs = result?.txs
        if (!Array.isArray(txs) || txs.length === 0) return null

        // Take the first matching tx
        const tx = txs[0]
        const height = parseInt(tx?.height || "0", 10)

        // Get the block time from the block header
        if (height > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const blockResult = await resilientRpcCall("block", {
                height: String(height),
            }) as any
            const timeStr = blockResult?.block?.header?.time
            if (timeStr) {
                return {
                    date: new Date(timeStr),
                    block: height,
                }
            }
        }
    } catch {
        // Indexer unavailable — expected on some networks
    }
    return null
}

// ── Public API ────────────────────────────────────────────────

/**
 * Resolve the creation timestamp for a proposal.
 *
 * Priority:
 * 1. `createdAt` ISO string from Render parsing (exact)
 * 2. `createdAtBlock` from Render parsing + block estimation (~approximate)
 * 3. tx-indexer search (exact, but may be unavailable)
 *
 * Returns null if no temporal data can be determined.
 */
export async function resolveProposalTimestamp(
    realmPath: string,
    proposalId: number,
    createdAt?: string,
    createdAtBlock?: number,
): Promise<ProposalTimestamp | null> {
    // Check cache first
    const cached = getCached(realmPath, proposalId)
    if (cached) {
        const date = new Date(cached.dateMs)
        return {
            date,
            block: cached.block,
            exact: cached.exact,
            label: cached.exact
                ? formatProposalDate(date).replace(/^~/, "")
                : formatProposalDate(date),
        }
    }

    // Strategy 1: ISO timestamp from Render (exact)
    if (createdAt) {
        const date = new Date(createdAt)
        if (!isNaN(date.getTime())) {
            const result: ProposalTimestamp = {
                date,
                block: createdAtBlock || null,
                exact: true,
                label: formatProposalDate(date).replace(/^~/, ""),
            }
            setCache(realmPath, proposalId, { dateMs: date.getTime(), block: result.block, exact: true })
            return result
        }
    }

    // Strategy 2: Block estimation (~approximate)
    if (createdAtBlock && createdAtBlock > 0) {
        const currentBlock = await getCurrentBlock()
        if (currentBlock > 0) {
            const date = estimateBlockDate(createdAtBlock, currentBlock)
            if (date) {
                const result: ProposalTimestamp = {
                    date,
                    block: createdAtBlock,
                    exact: false,
                    label: formatProposalDate(date), // Already includes "~" prefix
                }
                setCache(realmPath, proposalId, { dateMs: date.getTime(), block: createdAtBlock, exact: false })
                return result
            }
        }
    }

    // Strategy 3: tx-indexer search (exact, best-effort)
    const txResult = await searchProposalTx(realmPath, proposalId)
    if (txResult) {
        const result: ProposalTimestamp = {
            date: txResult.date,
            block: txResult.block,
            exact: true,
            label: formatProposalDate(txResult.date).replace(/^~/, ""),
        }
        setCache(realmPath, proposalId, { dateMs: txResult.date.getTime(), block: txResult.block, exact: true })
        return result
    }

    return null
}
