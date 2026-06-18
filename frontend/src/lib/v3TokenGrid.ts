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
 * Enumerate all tokens for a collection by iterating 0..supply-1.
 * Queries OwnerOf + TokenURI in parallel per token; skips gaps gracefully.
 *
 * @param collectionID - e.g. "creator/slug"
 * @param supply - minted count from CollectionDetail (0-based ceiling)
 * @param collectionPath - defaults to NFT_COLLECTIONS_PATH
 */
export async function fetchV3Tokens(
    collectionID: string,
    supply: number,
    collectionPath: string = NFT_COLLECTIONS_PATH,
): Promise<V3Token[]> {
    if (supply <= 0) return []

    const tokens: V3Token[] = []

    await Promise.all(
        Array.from({ length: supply }, (_, i) => String(i)).map(async (tid) => {
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
