/**
 * GRC721 NFT helpers — message builders, ABCI queries, and types.
 *
 * Phase 4b: Mirrors grc20.ts pattern for NFT operations.
 * Uses the standard GRC721 interface from gno.land/p/demo/grc/grc721.
 *
 * @module lib/grc721
 */

import { queryRender, queryEval } from "./dao/shared"
import { GNO_RPC_URL } from "./config"

// ── Types ────────────────────────────────────────────────────

export interface NFTCollection {
    /** Realm path (e.g., "gno.land/r/user/my_nft") */
    realmPath: string
    /** Collection name */
    name: string
    /** Collection symbol */
    symbol: string
    /** Total supply */
    totalSupply: number
    /** Creator address */
    creator: string
    /** Description */
    description: string
    /** Royalty percentage (0-10) */
    royaltyPercent: number
}

export interface NFTItem {
    /** Token ID */
    tokenId: string
    /** Owner address */
    owner: string
    /** Token URI (IPFS or HTTP) */
    tokenURI: string
    /** Metadata (parsed from URI if available) */
    metadata?: NFTMetadata
}

export interface NFTMetadata {
    name: string
    description: string
    image: string
    attributes?: { trait_type: string; value: string }[]
}

export interface NFTListing {
    tokenId: string
    seller: string
    price: number
    realmPath: string
}

// ── ABCI Queries ─────────────────────────────────────────────

/** Query collection info from Render(""). */
export async function getCollectionInfo(realmPath: string): Promise<NFTCollection | null> {
    try {
        const raw = await queryRender(GNO_RPC_URL, realmPath, "")
        if (!raw) return null
        return parseCollectionRender(raw, realmPath)
    } catch {
        return null
    }
}

/** Query NFT owner via vm/qeval. */
export async function getNFTOwner(realmPath: string, tokenId: string): Promise<string | null> {
    try {
        const result = await queryEval(GNO_RPC_URL, realmPath, `OwnerOf("${tokenId}")`)
        if (!result) return null
        // Result format: (string "g1addr...", error nil)
        const match = result.match(/"(g1[a-z0-9]+)"/)
        return match ? match[1] : null
    } catch {
        return null
    }
}

/** Query balance of an address via vm/qeval. */
export async function getNFTBalance(realmPath: string, owner: string): Promise<number> {
    try {
        const result = await queryEval(GNO_RPC_URL, realmPath, `BalanceOf("${owner}")`)
        if (!result) return 0
        const match = result.match(/(\d+)/)
        return match ? parseInt(match[1], 10) : 0
    } catch {
        return 0
    }
}

/** Query token URI via vm/qeval. */
export async function getTokenURI(realmPath: string, tokenId: string): Promise<string | null> {
    try {
        const result = await queryEval(GNO_RPC_URL, realmPath, `TokenURI("${tokenId}")`)
        if (!result) return null
        const match = result.match(/"([^"]+)"/)
        return match ? match[1] : null
    } catch {
        return null
    }
}

// ── Render Parser ────────────────────────────────────────────

function parseCollectionRender(raw: string, realmPath: string): NFTCollection {
    const nameMatch = raw.match(/^#\s*(.+)$/m)
    const symbolMatch = raw.match(/\*\*Symbol:\*\*\s*(\S+)/i) || raw.match(/Symbol:\s*(\S+)/i)
    const supplyMatch = raw.match(/\*\*Total Supply:\*\*\s*(\d+)/i) || raw.match(/Total Supply:\s*(\d+)/i)
    const creatorMatch = raw.match(/\*\*Creator:\*\*\s*(g1[a-z0-9]+)/i)
    const royaltyMatch = raw.match(/\*\*Royalty:\*\*\s*(\d+)%/i)
    const descLines = raw.split("\n").filter(l => l.trim() && !l.startsWith("#") && !l.startsWith("**"))

    return {
        realmPath,
        name: nameMatch?.[1]?.trim() || realmPath.split("/").pop() || "Unknown",
        symbol: symbolMatch?.[1] || "NFT",
        totalSupply: supplyMatch ? parseInt(supplyMatch[1], 10) : 0,
        creator: creatorMatch?.[1] || "",
        description: descLines[0]?.trim() || "",
        royaltyPercent: royaltyMatch ? parseInt(royaltyMatch[1], 10) : 0,
    }
}

// ── Message Builders ─────────────────────────────────────────

/** Build MsgCall to mint an NFT. */
export function buildMintMsg(
    caller: string,
    realmPath: string,
    to: string,
    tokenId: string,
    tokenURI: string,
) {
    return {
        type: "/vm.m_call",
        value: {
            caller,
            send: "",
            pkg_path: realmPath,
            func: "Mint",
            args: [to, tokenId, tokenURI],
        },
    }
}

/** Build MsgCall to transfer an NFT. */
export function buildTransferMsg(
    caller: string,
    realmPath: string,
    from: string,
    to: string,
    tokenId: string,
) {
    return {
        type: "/vm.m_call",
        value: {
            caller,
            send: "",
            pkg_path: realmPath,
            func: "TransferFrom",
            args: [from, to, tokenId],
        },
    }
}

/** Build MsgCall to approve an operator for a token. */
export function buildApproveMsg(
    caller: string,
    realmPath: string,
    approved: string,
    tokenId: string,
) {
    return {
        type: "/vm.m_call",
        value: {
            caller,
            send: "",
            pkg_path: realmPath,
            func: "Approve",
            args: [approved, tokenId],
        },
    }
}

/** Build MsgCall to burn an NFT. */
export function buildBurnMsg(
    caller: string,
    realmPath: string,
    tokenId: string,
) {
    return {
        type: "/vm.m_call",
        value: {
            caller,
            send: "",
            pkg_path: realmPath,
            func: "Burn",
            args: [tokenId],
        },
    }
}

/** Build MsgCall to list an NFT for sale (marketplace realm). */
export function buildListForSaleMsg(
    caller: string,
    marketplacePath: string,
    nftRealmPath: string,
    tokenId: string,
    priceUgnot: number,
) {
    return {
        type: "/vm.m_call",
        value: {
            caller,
            send: "",
            pkg_path: marketplacePath,
            func: "ListNFT",
            args: [nftRealmPath, tokenId, String(priceUgnot)],
        },
    }
}

/** Build MsgCall to buy a listed NFT. */
export function buildBuyMsg(
    caller: string,
    marketplacePath: string,
    nftRealmPath: string,
    tokenId: string,
    priceUgnot: number,
) {
    return {
        type: "/vm.m_call",
        value: {
            caller,
            send: `${priceUgnot}ugnot`,
            pkg_path: marketplacePath,
            func: "BuyNFT",
            args: [nftRealmPath, tokenId],
        },
    }
}
