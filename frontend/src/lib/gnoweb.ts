/**
 * gnoweb — namespace discovery and gnoweb links.
 *
 * Lists the realms and packages deployed under a namespace (e.g. "r/samcrew",
 * "p/samcrew") with the RPC's `vm/qpaths` ABCI query, and builds gnoweb URLs
 * for them. The listing is NOT read from gnoweb's HTML: gnoweb sends no
 * `Access-Control-Allow-Origin` header, so a browser fetch of it always failed.
 */

import { GNO_CHAIN_ID, NETWORKS } from "./config"
import { assertActiveRpcChain } from "./dao/chainIdentity"
import { resilientAbciQueryDetailed } from "./rpcFallback"

// ── Types ────────────────────────────────────────────────────

export interface NamespaceItem {
    /** Full realm/package path (e.g., "/r/samcrew/memba_dao") */
    path: string
    /** Short name extracted from path (e.g., "memba_dao") */
    name: string
    /** Full gnoweb URL */
    gnowebUrl: string
}

// ── Configuration ────────────────────────────────────────────

/**
 * Get the gnoweb base URL for a network KEY (e.g. "topaz" — NOT a chain id
 * like "topaz-1"). Returns undefined when the key is unknown; every caller
 * already treats that as "skip namespace discovery".
 *
 * Reads `NETWORKS[key].explorerUrl` rather than keeping a second map. There
 * used to be a local `GNOWEB_URLS` here holding only `test13` and `gnoland1`,
 * so after the topaz cutover `getGnowebUrl("topaz")` returned undefined: the
 * directory drawers fell back to `https://gno.land` (MAINNET, where our realms
 * 404) and `lib/directory`'s namespace discovery silently stopped marking
 * anything `deploymentStatus: "live"`. That is the exact regression the old
 * comment here said the `test13` entry existed to prevent — reintroduced for
 * the next network because the map had to be updated by hand. Deriving it from
 * NETWORKS means adding a network cannot reintroduce it a third time.
 */
export function getGnowebUrl(networkKey: string): string | undefined {
    return NETWORKS[networkKey]?.explorerUrl
}

// ── Namespace discovery (vm/qpaths) ──────────────────────────

/** Chain domain every package path starts with. directoryDiscovery prepends
 *  the same literal to the paths returned here. */
const CHAIN_DOMAIN = "gno.land"

/** Explicit `vm/qpaths` limit (the node's default is 1,000, its cap 10,000).
 *  The node truncates silently at the limit, so a listing this long is a
 *  prefix of the namespace, not all of it. */
export const NAMESPACE_LISTING_LIMIT = 1_000

/** A namespace is one non-empty path segment; a slash or dot in it would
 *  change which prefix the query lists. */
const NAMESPACE_RE = /^[a-zA-Z0-9_-]+$/
/** No dots (so no `..`), no empty segments, no trailing slash. */
const PACKAGE_PATH_RE = /^gno\.land\/[rp](\/[a-zA-Z0-9_-]+)+$/

/**
 * Parse a `vm/qpaths` answer (newline-separated package paths) into items for
 * `kind`/`namespace`. Lines are trimmed and deduplicated; anything outside the
 * requested namespace and kind, or not a well-formed package path, is dropped.
 *
 * `path` keeps the gnoweb form without the domain ("/r/samcrew/home"); `name`
 * is the path below the namespace ("home", "piechart/v0") so a versioned
 * package is not listed as just "v0".
 */
export function parseQpathsListing(text: string, gnowebBaseUrl: string, namespace: string, kind: "r" | "p"): NamespaceItem[] {
    const prefix = `${CHAIN_DOMAIN}/${kind}/${namespace}/`
    const seen = new Set<string>()
    const items: NamespaceItem[] = []
    for (const raw of text.split("\n")) {
        const line = raw.trim()
        if (!line.startsWith(prefix) || !PACKAGE_PATH_RE.test(line) || seen.has(line)) continue
        seen.add(line)
        const path = line.slice(CHAIN_DOMAIN.length)
        items.push({ path, name: line.slice(prefix.length), gnowebUrl: `${gnowebBaseUrl}${path}` })
    }
    return items
}

/**
 * List what is deployed under `/{kind}/{namespace}/` on `chainId`, via the RPC.
 *
 * `status: "ready"` means the chain answered (an empty namespace is `ready`
 * with no items); `"unavailable"` means it could not be asked. Nothing is
 * cached here: the caller's query cache (useDirectoryDiscovery, 5 minutes)
 * already holds the result, and a transient failure must not read as empty.
 *
 * The RPC failover list belongs to the ACTIVE network, so a `chainId` other
 * than the active one is `unavailable` rather than answered by the wrong
 * chain, and the endpoint's own chain id is checked before it is trusted.
 *
 * `baseUrl` is the network's gnoweb URL; it only builds the item links.
 */
export async function fetchNamespaceListing(baseUrl: string, namespace: string, kind: "r" | "p", chainId: string): Promise<{ items: NamespaceItem[]; status: "ready" | "unavailable" }> {
    if (chainId !== GNO_CHAIN_ID || !NAMESPACE_RE.test(namespace)) return { items: [], status: "unavailable" }
    try {
        await assertActiveRpcChain()
        const result = await resilientAbciQueryDetailed(
            `vm/qpaths?limit=${NAMESPACE_LISTING_LIMIT}`,
            `${CHAIN_DOMAIN}/${kind}/${namespace}/`,
        )
        // A namespace with nothing deployed answers with empty Data.
        if (result.kind === "empty") return { items: [], status: "ready" }
        if (result.kind === "abci-error") return { items: [], status: "unavailable" }
        return { items: parseQpathsListing(result.text, baseUrl, namespace, kind), status: "ready" }
    } catch { return { items: [], status: "unavailable" } }
}
