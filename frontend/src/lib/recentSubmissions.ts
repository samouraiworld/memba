import { API_BASE_URL } from "./config"
import { normalizeTxHashHex } from "./txExplorerUrl"

export const RECENT_SUBMISSIONS_ENDPOINT = `${API_BASE_URL}/api/directory/recent-submissions`
const MAINNET_CHAIN_ID = "gnoland-1"
const SOURCE = "official-mainnet-tx-indexer"
const PATH = /^gno\.land\/[rp]\/[a-z0-9_-]+\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/
const MAX_WINDOW = 10_200
const MAX_ROWS = 12
const CLIENT_TIMEOUT_MS = 8_000

export type RecentSubmissionKind = "package" | "realm"
export type RecentSubmissionsErrorKind = "timeout" | "wrong-source" | "invalid-response" | "unavailable"

export class RecentSubmissionsError extends Error {
    constructor(readonly kind: RecentSubmissionsErrorKind) {
        super(kind)
        this.name = "RecentSubmissionsError"
    }
}

export interface RecentSubmissionRow {
    path: string
    kind: RecentSubmissionKind
    creator: string
    txHash: string
    blockHeight: number
    txIndex: number
}

export interface RecentSubmissionsDocument {
    chainId: typeof MAINNET_CHAIN_ID
    source: typeof SOURCE
    checkedAt: string
    indexedHeight: number
    windowStart: number
    windowEnd: number
    coverage: "window-only"
    rows: RecentSubmissionRow[]
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function integer(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value)
}

/** Validate every row before sorting and deduplicating; no bad source data is displayed. */
export function parseRecentSubmissions(value: unknown): RecentSubmissionsDocument {
    if (!record(value)) throw new RecentSubmissionsError("invalid-response")
    if (value.chainId !== MAINNET_CHAIN_ID || value.source !== SOURCE) {
        throw new RecentSubmissionsError("wrong-source")
    }
    const { checkedAt, indexedHeight, windowStart, windowEnd, coverage } = value
    if (typeof checkedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(checkedAt) || !Number.isFinite(Date.parse(checkedAt)) ||
        !integer(indexedHeight) || !integer(windowStart) || !integer(windowEnd) || windowStart < 1 || windowEnd !== indexedHeight ||
        windowStart > windowEnd || windowEnd - windowStart + 1 > MAX_WINDOW || coverage !== "window-only" ||
        !Array.isArray(value.rows) || value.rows.length > MAX_ROWS) {
        throw new RecentSubmissionsError("invalid-response")
    }
    const rows: RecentSubmissionRow[] = value.rows.map(raw => {
        if (!record(raw) || typeof raw.path !== "string" || !PATH.test(raw.path) ||
            (raw.kind !== "package" && raw.kind !== "realm") ||
            raw.kind !== (raw.path.startsWith("gno.land/r/") ? "realm" : "package") ||
            typeof raw.creator !== "string" || raw.creator.trim() === "" ||
            typeof raw.txHash !== "string" || !normalizeTxHashHex(raw.txHash) ||
            !integer(raw.blockHeight) || raw.blockHeight < windowStart || raw.blockHeight > windowEnd ||
            !integer(raw.txIndex) || raw.txIndex < 0) {
            throw new RecentSubmissionsError("invalid-response")
        }
        return {
            path: raw.path, kind: raw.kind, creator: raw.creator,
            txHash: raw.txHash, blockHeight: raw.blockHeight, txIndex: raw.txIndex,
        }
    })
    rows.sort((a, b) => b.blockHeight - a.blockHeight || b.txIndex - a.txIndex || b.txHash.localeCompare(a.txHash) || a.path.localeCompare(b.path))
    const seen = new Set<string>()
    const unique = rows.filter(row => {
        if (seen.has(row.path)) return false
        seen.add(row.path)
        return true
    })
    return {
        chainId: MAINNET_CHAIN_ID, source: SOURCE, checkedAt,
        indexedHeight, windowStart, windowEnd, coverage: "window-only", rows: unique,
    }
}

/** The official RPC serves exact transaction and block JSON on gnoland-1. */
export function mainnetSubmissionTxUrl(hash: string): string | null {
    const hex = normalizeTxHashHex(hash)
    return hex ? `https://rpc.gno.land/tx?hash=0x${hex}` : null
}

export function mainnetSubmissionBlockUrl(height: number): string | null {
    return integer(height) && height > 0 ? `https://rpc.gno.land/block?height=${height}` : null
}

/** One fixed GET; React Query owns caching and passes its cancellation signal. */
export async function fetchRecentSubmissions(signal?: AbortSignal, timeoutMs = CLIENT_TIMEOUT_MS): Promise<RecentSubmissionsDocument> {
    const controller = new AbortController()
    let timedOut = false
    const onAbort = () => controller.abort()
    if (signal?.aborted) controller.abort()
    else signal?.addEventListener("abort", onAbort, { once: true })
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    try {
        const response = await fetch(RECENT_SUBMISSIONS_ENDPOINT, {
            method: "GET", headers: { Accept: "application/json" }, signal: controller.signal,
        })
        if (!response.ok) throw new RecentSubmissionsError("unavailable")
        const body: unknown = await response.json()
        return parseRecentSubmissions(body)
    } catch (error) {
        if (timedOut && !signal?.aborted) throw new RecentSubmissionsError("timeout")
        if (error instanceof RecentSubmissionsError) throw error
        if (signal?.aborted) throw error
        throw new RecentSubmissionsError("unavailable")
    } finally {
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
    }
}

export function recentSubmissionsCheckedAt(iso: string): string {
    const date = new Date(iso)
    return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`
}
