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

/** Most ids returned (newest first); each one costs a chain read. */
export const FREELANCER_CONTRACTS_MAX = 20

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
export function freelancerContractsQuery(escrowPath: string, freelancer: string, fromHeight = 1): string {
    // Both values are interpolated into the query, so only a realm path and a checksummed address get in.
    if (!REALM_PATH.test(escrowPath)) throw new Error("Invalid escrow realm path")
    if (!isValidGnoAddressChecksum(freelancer)) throw new Error("Invalid freelancer address")
    if (!Number.isSafeInteger(fromHeight) || fromHeight < 1) throw new Error("Invalid start height")
    return `{ transactions(filter:{ from_block_height:${fromHeight}, success:true, events:[{ gno_event:{ pkg_path:"${escrowPath}", type:"ContractCreated", attrs:[{ key:"freelancer", value:"${freelancer}" }] } }] }) {
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

/** Ids of this realm's contracts created with `freelancer` as freelancer, newest first (a hint: read each back from the chain). */
export async function findFreelancerContractIds(indexerUrl: string, chainId: string, escrowPath: string, freelancer: string, signal?: AbortSignal): Promise<string[]> {
    const data = await gql<unknown>(indexerUrl, freelancerContractsQuery(escrowPath, freelancer, escrowScanFromHeight(chainId, escrowPath)), signal)
    return parseFreelancerContracts(data, escrowPath, freelancer)
}
