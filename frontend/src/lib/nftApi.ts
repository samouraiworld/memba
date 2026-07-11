/**
 * nftApi.ts — typed wrappers over the 4 ConnectRPC NFT endpoints.
 * Each function returns data or null on failure (graceful degradation).
 * Callers MUST NOT crash when these return null — backend may not be deployed yet.
 */
import { api } from "./api"
import { API_BASE_URL } from "./config"

// Re-export proto types for convenience
export type { NFTToken, NFTActivity, GetNFTCollectionResponse } from "../gen/memba/v1/memba_pb"

export interface NFTCollectionStats {
    name: string
    symbol: string
    supply: bigint
    floorPriceUgnot: bigint
    totalVolumeUgnot: bigint
    totalSales: bigint
    activeListings: bigint
    royaltyBps: bigint
}

export interface NFTActivityItem {
    saleNo: bigint
    tokenId: string
    kind: string
    priceUgnot: bigint
    seller: string
    buyer: string
    createdAt: string
}

export interface NFTPortfolioToken {
    collectionId: string
    tokenId: string
    owner: string
    uri: string
    listed: boolean
    priceUgnot: bigint
}

/** Fetch collection stats. Returns null on any error (endpoint may be absent). */
export async function fetchNFTCollection(collectionId: string): Promise<NFTCollectionStats | null> {
    try {
        const res = await api.getNFTCollection({ collectionId })
        return {
            name: res.name,
            symbol: res.symbol,
            supply: res.supply,
            floorPriceUgnot: res.floorPriceUgnot,
            totalVolumeUgnot: res.totalVolumeUgnot,
            totalSales: res.totalSales,
            activeListings: res.activeListings,
            royaltyBps: res.royaltyBps,
        }
    } catch {
        return null
    }
}

/** Fetch recent activity. Returns [] on any error. */
export async function fetchNFTActivity(collectionId: string, limit = 50): Promise<NFTActivityItem[]> {
    try {
        const res = await api.getNFTActivity({ collectionId, limit })
        return res.items.map(item => ({
            saleNo: item.saleNo,
            tokenId: item.tokenId,
            kind: item.kind,
            priceUgnot: item.priceUgnot,
            seller: item.seller,
            buyer: item.buyer,
            createdAt: item.createdAt,
        }))
    } catch {
        return []
    }
}

/** Fetch portfolio for a wallet. Returns [] on error. */
export async function fetchNFTPortfolio(owner: string): Promise<NFTPortfolioToken[]> {
    try {
        const res = await api.getNFTPortfolio({ owner })
        return res.tokens.map(t => ({
            collectionId: t.collectionId,
            tokenId: t.tokenId,
            owner: t.owner,
            uri: t.uri,
            listed: t.listed,
            priceUgnot: t.priceUgnot,
        }))
    } catch {
        return []
    }
}

/** Fetch tokens in a collection. listedOnly=false returns all. Returns [] on error. */
export async function fetchNFTTokens(collectionId: string, listedOnly = false): Promise<NFTPortfolioToken[]> {
    try {
        const res = await api.listNFTTokens({ collectionId, listedOnly })
        return res.tokens.map(t => ({
            collectionId: t.collectionId,
            tokenId: t.tokenId,
            owner: t.owner,
            uri: t.uri,
            listed: t.listed,
            priceUgnot: t.priceUgnot,
        }))
    } catch {
        return []
    }
}

/**
 * Build a proxied image URL for a tokenURI.
 * Handles ipfs://, https://, and plain CID strings.
 * Falls back gracefully when API_BASE_URL is empty (dev proxy).
 */
export function nftImageUrl(uriOrCid: string): string {
    const base = API_BASE_URL || ""
    return `${base}/api/nft/image?uri=${encodeURIComponent(uriOrCid)}`
}

/**
 * Build a proxied metadata URL for a tokenURI.
 */
export function nftMetadataUrl(uri: string): string {
    const base = API_BASE_URL || ""
    return `${base}/api/nft/metadata?uri=${encodeURIComponent(uri)}`
}

// ── Genesis mint launch endpoints ────────────────────────────────────────────
// Both endpoints are env-gated server-side and 404 until ceremony time; null
// means "curated mint flow is off / wallet not allowlisted" — callers hide the
// affordance, they never treat null as an error.

export interface MintTicket {
    tid: number
    edition: number
    tokenURI: string
}

export interface AllowlistProof {
    root: string
    maxQty: number
    proof: string
}

async function getJsonOrNull<T>(url: string): Promise<T | null> {
    try {
        const res = await fetch(url)
        if (!res.ok) return null
        return (await res.json()) as T
    } catch {
        return null
    }
}

/** Next suggested tokenURI for the curated mint of `collectionID`; null =
 * endpoint off OR this collection isn't the curated one (the backend 404s any
 * collection other than its configured id — tickets never leak cross-collection). */
export function fetchMintTicket(collectionID: string): Promise<MintTicket | null> {
    const base = API_BASE_URL || ""
    return getJsonOrNull<MintTicket>(`${base}/api/nft/mint-ticket?collection=${encodeURIComponent(collectionID)}`)
}

/** Merkle proof for the Genesis allowlist; null = not allowlisted / off. */
export function fetchAllowlistProof(address: string): Promise<AllowlistProof | null> {
    const base = API_BASE_URL || ""
    return getJsonOrNull<AllowlistProof>(`${base}/api/nft/allowlist-proof?address=${encodeURIComponent(address)}`)
}
