/**
 * Recent on-chain activity, read from the official gno.land tx-indexer GraphQL
 * (e.g. https://indexer.test13.testnets.gno.land/graphql/query).
 *
 * Honesty contract: every item is a real, in-chain transaction (hash + height,
 * timestamp when the block-time is known). We never fabricate rows; an empty
 * window yields an empty list, which the UI renders as an invitation.
 *
 * `parseActivity` is the pure, unit-tested core. `fetchRecentActivity` wires the
 * two indexer queries (recent txs + the blocks for their timestamps) around it.
 */

export type ActivityKind = "token" | "deploy" | "governance" | "validator" | "transfer" | "run" | "call"

/** A single message's decoded value, as returned by the indexer message union. */
export interface IndexerMessageValue {
    __typename: string
    // MsgCall
    caller?: string
    pkg_path?: string
    func?: string
    // MsgAddPackage
    creator?: string
    package?: { path?: string }
    // BankMsgSend
    from_address?: string
    to_address?: string
    amount?: string
}

export interface IndexerTx {
    hash: string
    block_height: number
    success?: boolean
    messages: { value: IndexerMessageValue }[]
}

export interface ActivityItem {
    kind: ActivityKind
    /** Short human-readable summary, e.g. "Token activity · New" or "Deployed r/demo/foo". */
    title: string
    /** The acting address (g1…), truncated for display by the component. */
    actor: string
    pkgPath?: string
    func?: string
    txHash: string
    blockHeight: number
    /** ISO block time, when the height→time map has it; else undefined (UI omits time). */
    time?: string
    /** Additional messages in the same tx beyond the primary one shown. */
    extraCount: number
}

/** Drop the `gno.land/r/` or `gno.land/p/` prefix for compact display. */
function shortPath(p: string): string {
    return p.replace(/^gno\.land\/[rp]\//, "")
}

/** Classify a realm call by its package path (most-specific first). */
function classifyCall(pkgPath: string): ActivityKind {
    if (/\/gnops\/valopers(\/|$)/.test(pkgPath)) return "validator"
    if (/\/gov\/dao(\/|$)/.test(pkgPath) || /_dao(\/|$)/.test(pkgPath) || /\/dao(\/|$)/.test(pkgPath)) return "governance"
    if (/tokenfactory/.test(pkgPath)) return "token"
    return "call"
}

/** Does this realm path look like a DAO realm (so a deployment of it = "Created a DAO")? */
function isDaoPath(pkgPath: string): boolean {
    return /_dao(\/|$)/.test(pkgPath) || /\/dao(\/|$)/.test(pkgPath)
}

/** Verb-first, human title for a classified MsgCall — turns the monotonous
 *  "Governance · Approve" rows into scannable sentences ("Voted on governance").
 *  Honest: derived only from realm + func (no fabricated subjects). */
function callTitle(kind: ActivityKind, pkgPath: string, func: string): string {
    if (kind === "token") {
        if (/^New/i.test(func)) return "Launched a token"
        if (/^Mint/i.test(func)) return "Minted tokens"
        if (/^Burn/i.test(func)) return "Burned tokens"
        return `Token · ${func}`
    }
    if (kind === "governance") {
        if (/vote/i.test(func)) return "Voted on governance"
        if (/propos/i.test(func)) return "Proposed on governance"
        if (/^Execute/i.test(func)) return "Executed a proposal"
        return `Governance · ${func}`
    }
    if (kind === "validator") return `Validator · ${func}`
    return `${func} · ${shortPath(pkgPath)}`
}

/** Map one message value → the display fields of an activity item, or null if unclassifiable. */
function mapMessage(v: IndexerMessageValue):
    Pick<ActivityItem, "kind" | "title" | "actor" | "pkgPath" | "func"> | null {
    switch (v.__typename) {
        case "MsgAddPackage": {
            const path = v.package?.path ?? ""
            const title = isDaoPath(path) ? `Created a DAO · ${shortPath(path)}` : `Deployed ${shortPath(path)}`
            return { kind: "deploy", title, actor: v.creator ?? "", pkgPath: path }
        }
        case "MsgCall": {
            const pkgPath = v.pkg_path ?? ""
            const func = v.func ?? ""
            const kind = classifyCall(pkgPath)
            return { kind, title: callTitle(kind, pkgPath, func), actor: v.caller ?? "", pkgPath, func }
        }
        case "BankMsgSend":
            return { kind: "transfer", title: `Sent ${v.amount ?? ""}`.trim(), actor: v.from_address ?? "" }
        case "MsgRun":
            return { kind: "run", title: "Ran a script", actor: v.caller ?? "" }
        default:
            return null
    }
}

/**
 * Map indexer transactions → activity items, newest block first.
 * One item per tx (from its first classifiable message); a tx with only
 * unclassifiable messages is omitted. `blockTime` maps block_height → ISO time.
 */
export function parseActivity(
    txs: IndexerTx[],
    blockTime: Map<number, string>,
    opts?: { limit?: number; maxPerSource?: number },
): ActivityItem[] {
    const all: ActivityItem[] = []
    for (const t of [...txs].sort((a, b) => b.block_height - a.block_height)) {
        const msgs = t.messages ?? []
        let primary: ReturnType<typeof mapMessage> = null
        for (const m of msgs) {
            primary = mapMessage(m.value)
            if (primary) break
        }
        if (!primary) continue
        all.push({
            ...primary,
            txHash: t.hash,
            blockHeight: t.block_height,
            time: blockTime.get(t.block_height),
            extraCount: Math.max(0, msgs.length - 1),
        })
    }

    // Diversity cap (home feed): a single busy realm+func (e.g. a flood of
    // "Approve" on one governance realm) must not dominate the visible window.
    // We keep at most `maxPerSource` per (kind|pkgPath|func), preserving
    // newest-first order, so crowded-out kinds (deploys, transfers, launches)
    // surface. Excess rows are dropped from the *preview*, not the chain — the
    // feed is honest about being a recent, diversified sample. Unset (the
    // by-address path) keeps every row.
    const max = opts?.maxPerSource
    const selected = max == null
        ? all
        : (() => {
            const seen = new Map<string, number>()
            const out: ActivityItem[] = []
            for (const it of all) {
                const key = `${it.kind}|${it.pkgPath ?? ""}|${it.func ?? ""}`
                const n = seen.get(key) ?? 0
                if (n >= max) continue
                seen.set(key, n + 1)
                out.push(it)
            }
            return out
        })()

    return opts?.limit != null ? selected.slice(0, opts.limit) : selected
}

/** Compact relative time ("just now" / "5m" / "3h" / "2d") from an ISO string,
 *  measured against `now` (epoch ms). Pure — `now` is injected for testability. */
export function relativeActivityTime(iso: string | undefined, now: number): string {
    if (!iso) return ""
    const then = Date.parse(iso)
    if (Number.isNaN(then)) return ""
    const secs = Math.max(0, Math.round((now - then) / 1000))
    if (secs < 45) return "just now"
    const mins = Math.round(secs / 60)
    if (mins < 60) return `${mins}m`
    const hrs = Math.round(mins / 60)
    if (hrs < 24) return `${hrs}h`
    return `${Math.round(hrs / 24)}d`
}

/** Relative time against the current clock — for render (keeps `Date.now()` out of
 *  the React component body, where the purity lint rule forbids it). */
export function formatActivityTime(iso: string | undefined): string {
    return relativeActivityTime(iso, Date.now())
}

// ── Indexer wire layer ───────────────────────────────────────────────────────

const RECENT_WINDOW_BLOCKS = 400
const DEFAULT_LIMIT = 12

interface GraphQLResponse<T> {
    data?: T
    errors?: { message: string }[]
}

export async function gql<T>(indexerUrl: string, query: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(indexerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal,
    })
    if (!res.ok) throw new Error(`indexer HTTP ${res.status}`)
    const json = (await res.json()) as GraphQLResponse<T>
    if (json.errors?.length) throw new Error(json.errors[0].message)
    if (!json.data) throw new Error("indexer returned no data")
    return json.data
}

/**
 * Fetch recent successful transactions across the chain and shape them into
 * activity items with timestamps. Best-effort timestamps: if the blocks query
 * fails the items still render (without a time). Throws on a hard indexer error
 * so the caller can show a retry.
 */
export async function fetchRecentActivity(
    indexerUrl: string,
    opts?: { limit?: number; signal?: AbortSignal },
): Promise<ActivityItem[]> {
    const limit = opts?.limit ?? DEFAULT_LIMIT
    const { latestBlockHeight: tip } = await gql<{ latestBlockHeight: number }>(
        indexerUrl, `{ latestBlockHeight }`, opts?.signal,
    )
    if (!tip || tip <= 0) return []
    const from = Math.max(1, tip - RECENT_WINDOW_BLOCKS)

    const { transactions } = await gql<{ transactions: IndexerTx[] }>(
        indexerUrl,
        `{ transactions(filter:{from_block_height:${from}, to_block_height:${tip}, success:true}) {
            hash block_height
            messages { value { __typename
                ... on MsgCall { caller pkg_path func }
                ... on MsgAddPackage { creator package { path } }
                ... on BankMsgSend { from_address to_address amount }
            } }
        } }`,
        opts?.signal,
    )

    // Best-effort timestamps for the blocks we actually surface.
    const blockTime = new Map<number, string>()
    try {
        const { getBlocks } = await gql<{ getBlocks: { height: number; time: string }[] }>(
            indexerUrl,
            `{ getBlocks(where:{height:{gt:${from - 1}, lt:${tip + 1}}}) { height time } }`,
            opts?.signal,
        )
        for (const b of getBlocks ?? []) blockTime.set(b.height, b.time)
    } catch {
        // timestamps are optional — items still render without them
    }

    // maxPerSource diversifies the chain-wide feed so one busy realm can't wall
    // out everything else (the "10× Approve" problem).
    return parseActivity(transactions ?? [], blockTime, { limit, maxPerSource: 3 })
}

// ── By-address activity (one profile's own on-chain txs) ──────────────────────

/**
 * How many recent blocks back to scan for one address's activity. The indexer's
 * `transactions` field exposes NO server-side limit/order args, so it streams
 * EVERY matching tx — and the public proxy times out ("upstream fetch failed")
 * on an unbounded full-history scan for an active address. Windowing keeps the
 * query inside the proxy's budget. ~40k blocks ≈ the last ~1.5–2 days on test13
 * (~3.8s/block). This is the honest limitation: the profile Activity tab shows a
 * RECENT window, not the address's entire history. Env-overridable for ops.
 */
const ADDRESS_WINDOW_BLOCKS = (() => {
    const raw = Number(import.meta.env.VITE_PROFILE_ACTIVITY_WINDOW_BLOCKS)
    return Number.isFinite(raw) && raw > 0 ? raw : 40_000
})()
const ADDRESS_DEFAULT_LIMIT = 20

/** A bech32 g1… address. Used only to build the indexer string filter — we never
 *  interpolate untrusted free text, and an address fails this guard otherwise. */
function isAddr(a: string): boolean {
    return /^g1[0-9a-z]+$/.test(a)
}

/**
 * Recent on-chain activity for ONE address — the transactions where it is the
 * caller (MsgCall / MsgRun), the package creator (MsgAddPackage), or the sender
 * or recipient of a transfer (BankMsgSend). The indexer's `message` filter list
 * is OR-combined, so a single query catches every position. Results stream
 * ascending by height; `parseActivity` re-sorts newest-first and trims to `limit`.
 *
 * Honest by construction: an address with nothing in the window yields an empty
 * list (the indexer returns `transactions: null` → coerced to `[]`), never a
 * fabricated row. Throws on a hard indexer error so the caller can offer retry.
 * Returns `[]` (no throw) for a malformed address.
 */
export async function fetchAddressActivity(
    indexerUrl: string,
    address: string,
    opts?: { limit?: number; signal?: AbortSignal; windowBlocks?: number },
): Promise<ActivityItem[]> {
    if (!isAddr(address)) return []
    const limit = opts?.limit ?? ADDRESS_DEFAULT_LIMIT
    const window = opts?.windowBlocks ?? ADDRESS_WINDOW_BLOCKS

    const { latestBlockHeight: tip } = await gql<{ latestBlockHeight: number }>(
        indexerUrl, `{ latestBlockHeight }`, opts?.signal,
    )
    if (!tip || tip <= 0) return []
    const from = Math.max(1, tip - window)

    // OR across every address position a tx can hold this address in.
    const messageFilter =
        `[{ vm_param:{ exec:{ caller:"${address}" }}},` +
        `{ vm_param:{ add_package:{ creator:"${address}" }}},` +
        `{ vm_param:{ run:{ caller:"${address}" }}},` +
        `{ bank_param:{ send:{ from_address:"${address}" }}},` +
        `{ bank_param:{ send:{ to_address:"${address}" }}}]`

    const { transactions } = await gql<{ transactions: IndexerTx[] | null }>(
        indexerUrl,
        `{ transactions(filter:{ from_block_height:${from}, to_block_height:${tip}, message:${messageFilter} }) {
            hash block_height
            messages { value { __typename
                ... on MsgCall { caller pkg_path func }
                ... on MsgAddPackage { creator package { path } }
                ... on BankMsgSend { from_address to_address amount }
            } }
        } }`,
        opts?.signal,
    )

    const txs = transactions ?? []
    if (txs.length === 0) return []

    // Best-effort timestamps for the (few) blocks we actually surface — newest
    // first, then capped — so we never request times for thousands of blocks.
    const heights = [...new Set(txs.map(t => t.block_height))].sort((a, b) => b - a).slice(0, limit)
    const blockTime = new Map<number, string>()
    if (heights.length > 0) {
        const lo = Math.min(...heights)
        const hi = Math.max(...heights)
        try {
            const { getBlocks } = await gql<{ getBlocks: { height: number; time: string }[] }>(
                indexerUrl,
                `{ getBlocks(where:{height:{gt:${lo - 1}, lt:${hi + 1}}}) { height time } }`,
                opts?.signal,
            )
            for (const b of getBlocks ?? []) blockTime.set(b.height, b.time)
        } catch {
            // timestamps are optional — items still render without them
        }
    }

    return parseActivity(txs, blockTime, { limit })
}
