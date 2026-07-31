/**
 * gnoweb — Gnoweb namespace explorer client.
 *
 * Queries gnoweb HTML pages to discover deployed realms and packages
 * under a given namespace (e.g., "r/samcrew", "p/samcrew").
 *
 * Uses sessionStorage caching with 5-minute TTL.
 */

import { NETWORKS } from "./config"

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

// ── Caching ──────────────────────────────────────────────────

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const CACHE_PREFIX = "memba_gnoweb_"

function getCached<T>(key: string): T | null {
    try {
        const raw = sessionStorage.getItem(CACHE_PREFIX + key)
        if (!raw) return null
        const entry = JSON.parse(raw)
        if (
            typeof entry !== "object" || entry === null ||
            typeof entry.ts !== "number" || !("data" in entry)
        ) {
            sessionStorage.removeItem(CACHE_PREFIX + key)
            return null
        }
        if (Date.now() - entry.ts > CACHE_TTL) {
            sessionStorage.removeItem(CACHE_PREFIX + key)
            return null
        }
        return entry.data as T
    } catch {
        return null
    }
}

function setCache<T>(key: string, data: T): void {
    try {
        sessionStorage.setItem(
            CACHE_PREFIX + key,
            JSON.stringify({ data, ts: Date.now() }),
        )
    } catch { /* quota exceeded */ }
}

// ── HTML Parsing ─────────────────────────────────────────────

/**
 * Parse gnoweb namespace listing HTML into NamespaceItem[].
 *
 * Gnoweb namespace pages list deployed items as links:
 *   <a href="/r/samcrew/memba_dao">/r/samcrew/memba_dao</a>
 *
 * We extract all unique paths matching the namespace prefix pattern.
 */
export function parseGnowebListing(html: string, gnowebBaseUrl: string, kind: "r" | "p"): NamespaceItem[] {
    // Match href="/r/..." or "/p/..." patterns in the HTML
    const pattern = new RegExp(`href="(/${kind}/[^"]+)"`, "g")
    const seen = new Set<string>()
    const items: NamespaceItem[] = []

    let match: RegExpExecArray | null
    while ((match = pattern.exec(html)) !== null) {
        const path = match[1]
        // Skip the namespace root itself (e.g., /r/samcrew) and parent paths (e.g., /r/)
        // We want sub-paths only (paths with at least 3 segments: /r/namespace/item)
        const segments = path.split("/").filter(Boolean)
        if (segments.length < 3) continue

        if (!seen.has(path)) {
            seen.add(path)
            const name = segments[segments.length - 1]
            items.push({
                path,
                name,
                gnowebUrl: `${gnowebBaseUrl}${path}`,
            })
        }
    }

    return items
}

// ── Fetch ────────────────────────────────────────────────────

/**
 * Fetch all deployed realms under a namespace from gnoweb.
 * Returns cached results if available (5-min TTL).
 *
 * @param gnowebBaseUrl - Base gnoweb URL (e.g., "https://gnoweb.test12.moul.p2p.team")
 * @param namespace - Namespace path (e.g., "samcrew")
 * @returns Array of deployed realm items, or empty array on error
 *
 * ⚠️ gnoweb sends NO `Access-Control-Allow-Origin` header on any network
 * (verified 2026-07-31 against topaz, betanet and mainnet with an explicit
 * Origin). A browser `fetch()` here is therefore CORS-blocked — `no-cors`
 * returns an opaque body that cannot be parsed. So the two fetchers below
 * cannot succeed from the app today, on ANY network, and never could;
 * `deploymentStatus: "live"` has never actually been reachable in a browser.
 *
 * They are kept (rather than deleted) because they work verbatim behind a
 * same-origin proxy — the route `/api/indexer` already takes for the tx-indexer,
 * which has the same restriction. Until such a proxy exists, every call fails.
 * The failure paths below therefore cache their empty result: without that, each
 * Directory tab mount re-fired two requests that can only ever fail, uncached.
 */
export async function fetchNamespaceRealms(gnowebBaseUrl: string, namespace: string): Promise<NamespaceItem[]> {
    // Scope by host: the key omitted it, so a listing cached on one network was
    // served after switching to another (sessionStorage survives NetworkSync's reload).
    const cacheKey = `${gnowebBaseUrl}_realms_${namespace}`
    const cached = getCached<NamespaceItem[]>(cacheKey)
    if (cached) return cached

    try {
        const url = `${gnowebBaseUrl}/r/${namespace}`
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
        // Cache a definitive rejection only. A 5xx/429 is transient and must not
        // blackhole the next 5 minutes once a same-origin proxy makes this reachable.
        if (!response.ok) {
            if (response.status < 500 && response.status !== 429) setCache(cacheKey, [])
            return []
        }

        const html = await response.text()
        const items = parseGnowebListing(html, gnowebBaseUrl, "r")
        setCache(cacheKey, items)
        return items
    } catch (err) {
        // Only a CORS/network rejection (TypeError) is permanent for this host.
        // AbortSignal.timeout(10s) raises AbortError, which is transient — caching
        // that would turn one slow response into a 5-minute blackhole.
        if (err instanceof TypeError) setCache(cacheKey, [])
        return []
    }
}

/**
 * Fetch all deployed packages under a namespace from gnoweb.
 * Returns cached results if available (5-min TTL).
 *
 * Subject to the same CORS limitation as fetchNamespaceRealms above.
 */
export async function fetchNamespacePackages(gnowebBaseUrl: string, namespace: string): Promise<NamespaceItem[]> {
    const cacheKey = `${gnowebBaseUrl}_packages_${namespace}`
    const cached = getCached<NamespaceItem[]>(cacheKey)
    if (cached) return cached

    try {
        const url = `${gnowebBaseUrl}/p/${namespace}`
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
        // Cache a definitive rejection only. A 5xx/429 is transient and must not
        // blackhole the next 5 minutes once a same-origin proxy makes this reachable.
        if (!response.ok) {
            if (response.status < 500 && response.status !== 429) setCache(cacheKey, [])
            return []
        }

        const html = await response.text()
        const items = parseGnowebListing(html, gnowebBaseUrl, "p")
        setCache(cacheKey, items)
        return items
    } catch (err) {
        // Only a CORS/network rejection (TypeError) is permanent for this host.
        // AbortSignal.timeout(10s) raises AbortError, which is transient — caching
        // that would turn one slow response into a 5-minute blackhole.
        if (err instanceof TypeError) setCache(cacheKey, [])
        return []
    }
}

/**
 * Check if a specific realm is deployed on-chain via gnoweb.
 * Returns true if the realm exists, false otherwise.
 */
export async function isRealmDeployed(gnowebBaseUrl: string, realmPath: string): Promise<boolean> {
    try {
        const url = `${gnowebBaseUrl}${realmPath}`
        const response = await fetch(url, {
            method: "HEAD",
            signal: AbortSignal.timeout(5_000),
        })
        return response.ok
    } catch {
        return false
    }
}
