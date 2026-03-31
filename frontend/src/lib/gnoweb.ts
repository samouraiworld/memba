/**
 * gnoweb — Gnoweb namespace explorer client.
 *
 * Queries gnoweb HTML pages to discover deployed realms and packages
 * under a given namespace (e.g., "r/samcrew", "p/samcrew").
 *
 * Uses sessionStorage caching with 5-minute TTL.
 */

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

/** Gnoweb URLs per network chain ID. */
const GNOWEB_URLS: Record<string, string> = {
    test12: "https://gnoweb.test12.moul.p2p.team",
    "portal-loop": "https://gno.land",
    staging: "https://staging.gno.land",
    gnoland1: "https://gno.land",
}

/**
 * Get the gnoweb base URL for a given chain ID.
 * Returns undefined if no gnoweb is configured for the chain.
 */
export function getGnowebUrl(chainId: string): string | undefined {
    return GNOWEB_URLS[chainId]
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
 */
export async function fetchNamespaceRealms(gnowebBaseUrl: string, namespace: string): Promise<NamespaceItem[]> {
    const cacheKey = `realms_${namespace}`
    const cached = getCached<NamespaceItem[]>(cacheKey)
    if (cached) return cached

    try {
        const url = `${gnowebBaseUrl}/r/${namespace}`
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
        if (!response.ok) return []

        const html = await response.text()
        const items = parseGnowebListing(html, gnowebBaseUrl, "r")
        setCache(cacheKey, items)
        return items
    } catch {
        return []
    }
}

/**
 * Fetch all deployed packages under a namespace from gnoweb.
 * Returns cached results if available (5-min TTL).
 */
export async function fetchNamespacePackages(gnowebBaseUrl: string, namespace: string): Promise<NamespaceItem[]> {
    const cacheKey = `packages_${namespace}`
    const cached = getCached<NamespaceItem[]>(cacheKey)
    if (cached) return cached

    try {
        const url = `${gnowebBaseUrl}/p/${namespace}`
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
        if (!response.ok) return []

        const html = await response.text()
        const items = parseGnowebListing(html, gnowebBaseUrl, "p")
        setCache(cacheKey, items)
        return items
    } catch {
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
