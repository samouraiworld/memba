/**
 * GRC721 NFT helpers — message builders, ABCI queries, and types.
 *
 * v2: collectionID-aware reads to match the live memba_nft_v2 ABI.
 *     All read helpers take (collectionPath, collectionID, ...) so queries
 *     are routed to the correct sub-collection inside the realm.
 *
 * Uses the vm/qrender + vm/qeval pattern from dao/shared.
 *
 * @module lib/grc721
 */

import { queryRender, queryEval } from "./dao/shared"

// ── Types ────────────────────────────────────────────────────

/** Legacy type kept for backwards compat with NFTCollectionView. */
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
    /** Royalty percentage (0-10), derived from royaltyBPS/100 */
    royaltyPercent: number
}

/** v2 collection info, collectionID-aware. */
export interface NFTCollectionV2 {
    /** Realm path for the collection contract */
    collectionPath: string
    /** Collection sub-ID (e.g. "genesis") */
    collectionID: string
    /** Collection name */
    name: string
    /** Collection symbol */
    symbol: string
    /** Total supply */
    totalSupply: number
    /** Royalty in basis points (e.g. 500 = 5%) */
    royaltyBPS: number
    /** Address that receives royalty payments */
    royaltyRecipient: string
}

export interface NFTTokenInfo {
    /** Token ID */
    tokenId: string
    /** Owner address */
    owner: string
    /** Token URI (IPFS or HTTP) */
    tokenURI: string
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

// ── Pure Parsers (exported for testing) ─────────────────────

/**
 * Parse `Render(collectionID)` output from memba_nft_v2.
 *
 * Expected markdown format:
 * ```
 * # Memba Genesis
 *
 * Symbol: MGEN
 * Supply: 3
 * Royalty BPS: 500
 * Royalty Recipient: g1...
 * ```
 * Also handles bold variants: `**Symbol:** MGEN` etc.
 */
export function parseCollectionRenderV2(
    raw: string,
    collectionPath: string,
    collectionID: string,
): NFTCollectionV2 {
    const nameMatch = raw.match(/^#\s+(.+)$/m)
    const symbolMatch =
        raw.match(/\*\*Symbol:\*\*\s*(\S+)/i) ||
        raw.match(/^Symbol:\s*(\S+)/im)
    const supplyMatch =
        raw.match(/\*\*Supply:\*\*\s*(\d+)/i) ||
        raw.match(/^Supply:\s*(\d+)/im)
    const royaltyBPSMatch =
        raw.match(/\*\*Royalty BPS:\*\*\s*(\d+)/i) ||
        raw.match(/^Royalty BPS:\s*(\d+)/im)
    const royaltyRecipientMatch =
        raw.match(/\*\*Royalty Recipient:\*\*\s*(g1[a-z0-9]+)/i) ||
        raw.match(/^Royalty Recipient:\s*(g1[a-z0-9]+)/im)

    return {
        collectionPath,
        collectionID,
        name: nameMatch?.[1]?.trim() || collectionPath.split("/").pop() || "Unknown",
        symbol: symbolMatch?.[1] || "NFT",
        totalSupply: supplyMatch ? parseInt(supplyMatch[1], 10) : 0,
        royaltyBPS: royaltyBPSMatch ? parseInt(royaltyBPSMatch[1], 10) : 0,
        royaltyRecipient: royaltyRecipientMatch?.[1] || "",
    }
}

/**
 * Parse `Render(collectionID + "/" + tokenId)` output.
 *
 * Expected markdown format:
 * ```
 * # Token 1
 *
 * Owner: g1...
 * URI: ipfs://...
 * ```
 */
export function parseTokenRender(raw: string, tokenId: string): NFTTokenInfo {
    const ownerMatch =
        raw.match(/\*\*Owner:\*\*\s*(g1[a-z0-9]+)/i) ||
        raw.match(/^Owner:\s*(g1[a-z0-9]+)/im)
    const uriMatch =
        raw.match(/\*\*URI:\*\*\s*(\S+)/i) ||
        raw.match(/^URI:\s*(\S+)/im)

    return {
        tokenId,
        owner: ownerMatch?.[1] || "",
        tokenURI: uriMatch?.[1] || "",
    }
}

/** Parse OwnerOf qeval result: `("g1addr..." string)` → address. */
export function parseOwnerOfResult(result: string): string | null {
    if (!result) return null
    const match = result.match(/"(g1[a-z0-9]+)"/)
    return match ? match[1] : null
}

/** Parse TokenURI qeval result: `("ipfs://..." string)` → URI. */
export function parseTokenURIResult(result: string): string | null {
    if (!result) return null
    const match = result.match(/"([^"]+)"/)
    return match ? match[1] : null
}

/** Parse IsApprovedForAll qeval result: `(true bool)` or `(false bool)`. */
export function parseIsApprovedForAllResult(result: string): boolean {
    if (!result) return false
    return result.includes("true")
}

// ── ABCI Queries (collectionID-aware) ────────────────────────
//
// B-4: every read helper takes rpcUrl as its FIRST argument (the
// queryRender/queryEval convention) and threads it through, so callers —
// notably the CAL's GnoProvider with its per-network config.rpcUrl — actually
// control which network is read. App code targeting the active network passes
// GNO_RPC_URL and keeps the resilient failover chain.

/**
 * Fetch collection info by querying `Render(collectionID)`.
 * Returns null on error or missing realm.
 */
export async function getCollectionInfo(
    rpcUrl: string,
    collectionPath: string,
    collectionID: string,
): Promise<NFTCollectionV2 | null> {
    try {
        const raw = await queryRender(rpcUrl, collectionPath, collectionID)
        if (!raw) return null
        return parseCollectionRenderV2(raw, collectionPath, collectionID)
    } catch {
        return null
    }
}

/**
 * Legacy single-collection read for old callers using realmPath only
 * (NFTCollectionView). Reads `Render("")` and maps to NFTCollection.
 *
 * A named function, NOT an overload of getCollectionInfo: with rpcUrl-first
 * both signatures would be (string, string), so an un-migrated v2 call
 * `getCollectionInfo(collectionPath, collectionID)` would still typecheck,
 * treat a realm path as an RPC URL, and fail silently through the catch.
 *
 * @deprecated for new code — use getCollectionInfo(rpcUrl, collectionPath, collectionID).
 */
export async function getLegacyCollectionInfo(
    rpcUrl: string,
    realmPath: string,
): Promise<NFTCollection | null> {
    try {
        const raw = await queryRender(rpcUrl, realmPath, "")
        if (!raw) return null
        return parseLegacyCollectionRender(raw, realmPath)
    } catch {
        return null
    }
}

/**
 * Query the owner of a token via qeval `OwnerOf(collectionID, tokenId)`.
 * Returns null if the token doesn't exist or the query fails.
 */
export async function getNFTOwner(
    rpcUrl: string,
    collectionPath: string,
    collectionID: string,
    tokenId: string,
): Promise<string | null> {
    try {
        const result = await queryEval(
            rpcUrl,
            collectionPath,
            `OwnerOf("${collectionID}", "${tokenId}")`,
        )
        if (!result) return null
        return parseOwnerOfResult(result)
    } catch {
        return null
    }
}

/**
 * Query balance of an address via qeval `BalanceOf(collectionID, owner)`.
 */
export async function getNFTBalance(
    rpcUrl: string,
    collectionPath: string,
    collectionID: string,
    owner: string,
): Promise<number> {
    try {
        const result = await queryEval(
            rpcUrl,
            collectionPath,
            `BalanceOf("${collectionID}", "${owner}")`,
        )
        if (!result) return 0
        const match = result.match(/(\d+)/)
        return match ? parseInt(match[1], 10) : 0
    } catch {
        return 0
    }
}

/**
 * Query token URI via qeval `TokenURI(collectionID, tokenId)`.
 */
export async function getTokenURI(
    rpcUrl: string,
    collectionPath: string,
    collectionID: string,
    tokenId: string,
): Promise<string | null> {
    try {
        const result = await queryEval(
            rpcUrl,
            collectionPath,
            `TokenURI("${collectionID}", "${tokenId}")`,
        )
        if (!result) return null
        return parseTokenURIResult(result)
    } catch {
        return null
    }
}

/**
 * Check whether `operator` is approved-for-all for `owner`'s tokens
 * in the given collection via qeval `IsApprovedForAll(collectionID, owner, operator)`.
 */
export async function isApprovedForAll(
    rpcUrl: string,
    collectionPath: string,
    collectionID: string,
    owner: string,
    operator: string,
): Promise<boolean> {
    try {
        const result = await queryEval(
            rpcUrl,
            collectionPath,
            `IsApprovedForAll("${collectionID}", "${owner}", "${operator}")`,
        )
        if (!result) return false
        return parseIsApprovedForAllResult(result)
    } catch {
        return false
    }
}

/**
 * List all tokens in a collection by:
 * 1. Fetching supply from `getCollectionInfo`.
 * 2. Querying `Render(collectionID/N)` for each token 1..supply.
 *    Tokens that fail (e.g. burned gaps) are skipped gracefully.
 *
 * Returns an array of NFTTokenInfo sorted by tokenId string.
 */
export async function listCollectionTokens(
    rpcUrl: string,
    collectionPath: string,
    collectionID: string,
): Promise<NFTTokenInfo[]> {
    const info = await getCollectionInfo(rpcUrl, collectionPath, collectionID)
    if (!info || info.totalSupply === 0) return []

    const supply = info.totalSupply
    const results: NFTTokenInfo[] = []

    await Promise.all(
        Array.from({ length: supply }, (_, i) => String(i + 1)).map(async (tid) => {
            try {
                const raw = await queryRender(rpcUrl, collectionPath, `${collectionID}/${tid}`)
                if (!raw) return
                const token = parseTokenRender(raw, tid)
                // Skip tokens with no owner (burned/non-existent gap)
                if (token.owner) results.push(token)
            } catch {
                // Token gap — skip silently
            }
        }),
    )

    // Sort by numeric tokenId order
    results.sort((a, b) => parseInt(a.tokenId, 10) - parseInt(b.tokenId, 10))
    return results
}

// ── Legacy Render Parser ─────────────────────────────────────

function parseLegacyCollectionRender(raw: string, realmPath: string): NFTCollection {
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
        type: "vm/MsgCall",
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
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: realmPath,
            func: "TransferFrom",
            args: [from, to, tokenId],
        },
    }
}

/** Build MsgCall to approve an operator for a token (legacy single-collection style). */
export function buildApproveMsg(
    caller: string,
    realmPath: string,
    approved: string,
    tokenId: string,
) {
    return {
        type: "vm/MsgCall",
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
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: realmPath,
            func: "Burn",
            args: [tokenId],
        },
    }
}

/** Build MsgCall to list an NFT for sale (legacy marketplace realm). */
export function buildListForSaleMsg(
    caller: string,
    marketplacePath: string,
    nftRealmPath: string,
    tokenId: string,
    priceUgnot: number,
) {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: "",
            pkg_path: marketplacePath,
            func: "ListNFT",
            args: [nftRealmPath, tokenId, String(priceUgnot)],
        },
    }
}

/** Build MsgCall to buy a listed NFT (legacy). */
export function buildBuyMsg(
    caller: string,
    marketplacePath: string,
    nftRealmPath: string,
    tokenId: string,
    priceUgnot: number,
) {
    return {
        type: "vm/MsgCall",
        value: {
            caller,
            send: `${priceUgnot}ugnot`,
            pkg_path: marketplacePath,
            func: "BuyNFT",
            args: [nftRealmPath, tokenId],
        },
    }
}
