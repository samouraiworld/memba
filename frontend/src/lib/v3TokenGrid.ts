/**
 * v3TokenGrid.ts — Token enumeration and listed-state helpers for the v3
 * memba_collections launchpad page.
 *
 * Enumeration strategy: iterate tokenId "0".."supply-1" via getNFTOwner +
 * getTokenURI against NFT_COLLECTIONS_PATH. Tokens that fail (burned gaps) are
 * skipped gracefully. Listed state is fetched from the v3 marketplace Render("").
 *
 * @module lib/v3TokenGrid
 */

import { getNFTOwner, getTokenURI } from "./grc721"
import { queryRender } from "./dao/shared"
import { parseMarketplaceRender } from "./nftMarketplace"
import { GNO_RPC_URL } from "./config"
import { NFT_COLLECTIONS_PATH, NFT_MARKETPLACE_V3_PATH } from "./nftConfig"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface V3Token {
    tokenId: string
    owner: string
    uri: string
}

export interface V3ListingInfo {
    priceUgnot: number
    seller: string
}

/**
 * Map from "<collectionID>/<tokenId>" → listing info.
 * Key format mirrors how parseMarketplaceRender returns (nftRealm = collectionID,
 * tokenId = tokenId).
 */
export type V3ListingMap = Map<string, V3ListingInfo>

// ── Token enumeration ─────────────────────────────────────────────────────────

/**
 * Default enumeration window. Bounds the per-load RPC fan-out: without this, a
 * collection of N tokens fired 2×N parallel RPC calls (OwnerOf + TokenURI each),
 * which stalls the page and hammers the node for large collections. True O(1)-per-
 * page enumeration needs a realm-side paginated getter (TokensOfCollection),
 * landing with the v3.1 redeploy (Marketplace plan W1.2); until then we window.
 */
export const DEFAULT_TOKEN_WINDOW = 60

/** Max RPC requests in flight at once while enumerating a window. */
export const DEFAULT_TOKEN_CONCURRENCY = 12

export interface FetchV3TokensOpts {
    /** First tokenId to enumerate (default 0). */
    offset?: number
    /** Max tokens to enumerate this call (default DEFAULT_TOKEN_WINDOW). */
    limit?: number
    /** Max concurrent RPC requests (default DEFAULT_TOKEN_CONCURRENCY). */
    concurrency?: number
}

/**
 * Enumerate a bounded window of a collection's tokens (tokenIds
 * `offset..offset+limit-1`, clamped to supply). Queries OwnerOf + TokenURI per
 * token, chunked to at most `concurrency` requests in flight; skips gaps (no
 * owner) gracefully and returns tokens sorted by numeric id.
 *
 * @param collectionID - e.g. "creator/slug"
 * @param supply - minted count from CollectionDetail (0-based ceiling)
 * @param collectionPath - defaults to NFT_COLLECTIONS_PATH
 * @param opts - window + concurrency bounds
 */
export async function fetchV3Tokens(
    collectionID: string,
    supply: number,
    collectionPath: string = NFT_COLLECTIONS_PATH,
    opts: FetchV3TokensOpts = {},
): Promise<V3Token[]> {
    if (supply <= 0) return []

    const offset = Math.max(0, opts.offset ?? 0)
    const limit = Math.max(0, opts.limit ?? DEFAULT_TOKEN_WINDOW)
    const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_TOKEN_CONCURRENCY)
    if (limit === 0 || offset >= supply) return []

    const end = Math.min(supply, offset + limit)
    const ids = Array.from({ length: end - offset }, (_, i) => String(offset + i))

    const tokens: V3Token[] = []
    // Chunked concurrency: process at most `concurrency` ids per wave so a large
    // window can't spike thousands of simultaneous RPC calls.
    for (let i = 0; i < ids.length; i += concurrency) {
        const chunk = ids.slice(i, i + concurrency)
        await Promise.all(
            chunk.map(async (tid) => {
                try {
                    const [owner, uri] = await Promise.all([
                        getNFTOwner(collectionPath, collectionID, tid),
                        getTokenURI(collectionPath, collectionID, tid),
                    ])
                    if (owner) {
                        tokens.push({ tokenId: tid, owner, uri: uri ?? "" })
                    }
                } catch {
                    // Token gap — skip silently
                }
            }),
        )
    }

    // Sort by numeric tokenId order
    tokens.sort((a, b) => parseInt(a.tokenId, 10) - parseInt(b.tokenId, 10))
    return tokens
}

// ── Listed state ──────────────────────────────────────────────────────────────

/**
 * Fetch all active v3 listings and build a lookup map keyed by
 * "<collectionID>/<tokenId>" for O(1) per-token checks.
 *
 * @param collectionID - filter to this collection only
 * @param marketPath - defaults to NFT_MARKETPLACE_V3_PATH
 */
export async function fetchV3Listings(
    collectionID: string,
    marketPath: string = NFT_MARKETPLACE_V3_PATH,
): Promise<V3ListingMap> {
    const map: V3ListingMap = new Map()
    try {
        const raw = await queryRender(GNO_RPC_URL, marketPath, "")
        if (!raw) return map
        const { listings } = parseMarketplaceRender(raw)
        for (const l of listings) {
            // nftRealm in the Render output is the collectionID passed to ListNFT
            if (l.nftRealm === collectionID) {
                map.set(`${collectionID}/${l.tokenId}`, {
                    priceUgnot: l.priceUgnot,
                    seller: l.seller,
                })
            }
        }
    } catch {
        // Marketplace realm may not be deployed yet — return empty map
    }
    return map
}

/**
 * Convenience key for the listing map.
 * @param collectionID - e.g. "creator/slug"
 * @param tokenId - e.g. "0"
 */
export function listingKey(collectionID: string, tokenId: string): string {
    return `${collectionID}/${tokenId}`
}
