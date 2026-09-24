/**
 * escrowIndexer.ts — best-effort discovery of the escrow contracts that name an
 * address as freelancer.
 *
 * escrow_v4 indexes contracts by client only (GetClientContractsJSON), so a
 * freelancer cannot list their contracts from the realm. CreateContract emits
 * `ContractCreated(id, client, freelancer, milestones)`, and the gno.land
 * tx-indexer filters transactions by event type, package and attribute (checked
 * against indexer.gno.land on 2026-09-24: a known event matched on one
 * attribute, and a wrong attribute value matched nothing). The browser reaches
 * the indexer only through the backend proxy (getIndexerUrl(), mainnet only).
 *
 * The indexer is a hint, never the source of truth: callers must read each id
 * back from the realm (GetContractJSON) and keep it only if the chain names
 * the address as freelancer. An archived contract reads as absent there.
 */
import { gql } from "../activity"
import { isValidGnoAddressChecksum } from "../dao/address"

const CONTRACT_ID = /^(0|[1-9]\d{0,8})$/
const REALM_PATH = /^gno\.land\/r\/[a-z0-9_]+(\/[a-z0-9_]+)*$/

/** Most ids per page (newest first); each one costs a chain read. */
export const FREELANCER_CONTRACTS_MAX = 10

/**
 * The indexer's transaction query takes no limit, so a query is bounded by
 * its block range instead: one window is about 7.6 days at gnoland-1's
 * ~3.3 s per block, and one page scans at most FREELANCER_MAX_WINDOWS windows
 * (about a month) before handing back a cursor. Each query stays far inside
 * the backend proxy's 10 s budget whatever the realm's age.
 */
export const FREELANCER_WINDOW_BLOCKS = 200_000
export const FREELANCER_MAX_WINDOWS = 4

/**
 * Publish height of each escrow realm, by chain id, from realm-versions.json
 * (escrowIndexer.test.ts checks they match). No contract can be older, so the
 * scan starts there: unbounded, the same query took about 6 s on 2026-09-24
 * against the backend proxy's 10 s budget; bounded, under 0.5 s.
 */
export const ESCROW_PUBLISH_HEIGHTS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
    "gnoland-1": { "gno.land/r/samcrew/escrow_v4": 299_934 },
}

/** First block to scan for this realm on this chain (1 when its publish height is not recorded). */
export function escrowScanFromHeight(chainId: string, escrowPath: string): number {
    return ESCROW_PUBLISH_HEIGHTS[chainId]?.[escrowPath] ?? 1
}

/** An indexer answer the parser does not recognise. */
export class EscrowIndexerError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "EscrowIndexerError"
    }
}

const bad = (what: string): never => { throw new EscrowIndexerError(`Unexpected indexer answer: ${what}`) }

/** The GraphQL query: successful transactions whose ContractCreated event on this realm names this freelancer. */
export function freelancerContractsQuery(escrowPath: string, freelancer: string, fromHeight = 1, toHeight?: number): string {
    // Both values are interpolated into the query, so only a realm path and a checksummed address get in.
    if (!REALM_PATH.test(escrowPath)) throw new Error("Invalid escrow realm path")
    if (!isValidGnoAddressChecksum(freelancer)) throw new Error("Invalid freelancer address")
    if (!Number.isSafeInteger(fromHeight) || fromHeight < 1) throw new Error("Invalid start height")
    if (toHeight !== undefined && (!Number.isSafeInteger(toHeight) || toHeight < fromHeight)) throw new Error("Invalid end height")
    const to = toHeight === undefined ? "" : ` to_block_height:${toHeight},`
    return `{ transactions(filter:{ from_block_height:${fromHeight},${to} success:true, events:[{ gno_event:{ pkg_path:"${escrowPath}", type:"ContractCreated", attrs:[{ key:"freelancer", value:"${freelancer}" }] } }] }) {
        response { events { ... on GnoEvent { type pkg_path attrs { key value } } } }
    } }`
}

type Attr = { key: string; value: string }

/**
 * Contract ids from the indexer's answer, newest first, at most `max`. Only
 * ContractCreated events of this realm that name this freelancer count; other
 * events in the same transactions are ignored. A malformed answer throws.
 */
export function parseFreelancerContracts(data: unknown, escrowPath: string, freelancer: string, max = FREELANCER_CONTRACTS_MAX): string[] {
    if (typeof data !== "object" || data === null) return bad("no data")
    const txs = (data as { transactions?: unknown }).transactions
    if (txs === null) return []
    if (!Array.isArray(txs)) return bad("transactions")
    const ids = new Set<number>()
    for (const tx of txs) {
        const events = (tx as { response?: { events?: unknown } })?.response?.events
        if (events === null || events === undefined) continue
        if (!Array.isArray(events)) bad("events")
        for (const e of events as unknown[]) {
            // Non-Gno events (storage, transfer) come back as {} through the inline fragment.
            if (typeof e !== "object" || e === null) bad("event")
            const ev = e as { type?: unknown; pkg_path?: unknown; attrs?: unknown }
            if (ev.type !== "ContractCreated" || ev.pkg_path !== escrowPath) continue
            if (!Array.isArray(ev.attrs)) bad("event attributes")
            const attrs = ev.attrs as Attr[]
            const get = (key: string) => {
                const hits = attrs.filter((a) => a && a.key === key)
                return hits.length === 1 && typeof hits[0].value === "string" ? hits[0].value : null
            }
            if (get("freelancer") !== freelancer) continue
            const id = get("id")
            if (id === null || !CONTRACT_ID.test(id)) bad("contract id")
            ids.add(Number(id))
        }
    }
    return [...ids].sort((a, b) => b - a).slice(0, max).map(String)
}

/**
 * Where the next page resumes: scan down from block `top`, skipping ids at or
 * above `belowId` (the last one already shown; ids grow with height, so older
 * contracts in the same window come next).
 */
export interface FreelancerCursor {
    top: number
    belowId: number | null
}

export interface FreelancerPage {
    /** Contract ids, newest first, at most FREELANCER_CONTRACTS_MAX: a hint to read back from the chain. */
    ids: string[]
    /** Null once the scan reached the realm's publish height. */
    next: FreelancerCursor | null
}

/**
 * One page of this realm's contracts naming `freelancer`, newest first. The
 * first page (`cursor` null) starts at the indexer's latest height. Each query
 * covers one bounded window; a page stops at FREELANCER_CONTRACTS_MAX ids or
 * after FREELANCER_MAX_WINDOWS windows, whichever comes first. Errors
 * (including the proxy's timeout, "indexer HTTP 502") propagate.
 */
export async function findFreelancerContractsPage(
    indexerUrl: string,
    chainId: string,
    escrowPath: string,
    freelancer: string,
    cursor: FreelancerCursor | null,
    signal?: AbortSignal,
): Promise<FreelancerPage> {
    const floor = escrowScanFromHeight(chainId, escrowPath)
    let top = cursor?.top ?? (await gql<{ latestBlockHeight: number }>(indexerUrl, "{ latestBlockHeight }", signal)).latestBlockHeight
    if (!Number.isSafeInteger(top) || top < 0) bad("latest block height")
    let belowId = cursor?.belowId ?? null
    const ids: number[] = []
    for (let w = 0; w < FREELANCER_MAX_WINDOWS && top >= floor; w++) {
        const from = Math.max(floor, top - FREELANCER_WINDOW_BLOCKS + 1)
        const data = await gql<unknown>(indexerUrl, freelancerContractsQuery(escrowPath, freelancer, from, top), signal)
        const found = parseFreelancerContracts(data, escrowPath, freelancer, Number.MAX_SAFE_INTEGER)
            .map(Number)
            .filter((id) => belowId === null || id < belowId)
        const room = FREELANCER_CONTRACTS_MAX - ids.length
        ids.push(...found.slice(0, room))
        if (found.length > room) {
            // This window holds more: the next page re-reads it below the last id shown.
            return { ids: ids.map(String), next: { top, belowId: ids[ids.length - 1] } }
        }
        top = from - 1
        belowId = null
        if (ids.length === FREELANCER_CONTRACTS_MAX) break
    }
    return { ids: ids.map(String), next: top >= floor ? { top, belowId: null } : null }
}

