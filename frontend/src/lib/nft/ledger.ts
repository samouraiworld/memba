/**
 * Strict reads of the NFT ledger realm. Every answer is checked against the
 * realm's JSON contract and the rules the realm itself enforces before it
 * reaches a screen: an unreadable answer throws a ReadError (worth retrying),
 * a query the realm refuses (a collection or a token that does not exist)
 * throws a RealmRefusedError, and a malformed or self-contradicting answer
 * throws a plain Error (the network's data cannot be used), so none can be
 * mistaken for an empty ledger. The realm is not published on any network
 * yet; NFT_LEDGER_PATH stays out of the realm allowlist until it is.
 *
 * @module lib/nft/ledger
 */
import { HASH, address, bool, collectionId, decimal, list, oneOf, optionalAddress, record, text, tokenNumber } from "./parse"
import { ReadError, natural, readInt, readJSON, readPage, readSlice } from "./read"

export const NFT_LEDGER_PATH = "gno.land/r/samcrew/launchpad/nft/v1"

const MODES = ["open", "royalty_protected", "soulbound"] as const
const METADATA_MODES = ["static", "reveal", "mutable"] as const
const TOKEN_STATUSES = ["active", "burned", "revoked"] as const
const ROYALTY_ENFORCEMENTS = ["none", "market_sales", "listed_markets"] as const
const CAPABILITIES_SCHEMA = "launchpad-nft-capabilities/v1"

export type NftMode = (typeof MODES)[number]
export type NftMetadataMode = (typeof METADATA_MODES)[number]
export type NftTokenStatus = (typeof TOKEN_STATUSES)[number]
export type NftRoyaltyEnforcement = (typeof ROYALTY_ENFORCEMENTS)[number]

export interface NftRoyalty {
    account: string
    bps: bigint
}

/** One row of the collection list: what a rail needs, not the full record. */
export interface NftCollectionSummary {
    id: string
    creator: string
    name: string
    symbol: string
    image: string
    mode: NftMode
    /** Zero means uncapped (an open edition). */
    maxSupply: bigint
    /** True once no further token can ever be minted. */
    sealed: boolean
    minted: bigint
}

/** The newest collections, newest first, out of `total` on the ledger. */
export interface NftNewestCollections {
    total: bigint
    collections: NftCollectionSummary[]
}

export interface NftCollection {
    id: string
    grc721Id: string
    /** The realm that created the collection. */
    issuer: string
    creator: string
    /** The creator at creation: it never changes when the role is handed over. */
    originator: string
    /** Empty unless a creator handoff is waiting to be accepted. */
    pendingCreator: string
    name: string
    symbol: string
    description: string
    image: string
    banner: string
    website: string
    mode: NftMode
    revocable: boolean
    /** Zero means uncapped (an open edition). */
    maxSupply: bigint
    /** True once no further token can ever be minted. */
    sealed: boolean
    minted: bigint
    totalSupply: bigint
    profileFrozen: boolean
    metadataMode: NftMetadataMode
    metadataFrozen: boolean
    metadataRevision: bigint
    baseURI: string
    placeholderURI: string
    baseURICommitment: string
    /** Reveal only: the account that created the collection, to which the commitment stays bound whoever is creator now. */
    committer: string
    provenanceHash: string
    traitsRoot: string
    royaltyBPS: bigint
    royalties: NftRoyalty[]
    markets: string[]
}

export interface NftToken {
    collection: string
    number: bigint
    /** Empty once the token is burned or revoked. */
    owner: string
    status: NftTokenStatus
    uri: string
}

/** One row of a wallet's holdings: a token the account owns, in any collection. */
export interface NftHolding {
    collection: string
    number: bigint
    uri: string
}

/** Whether an operator may move an active token, and on whose behalf. */
export interface NftApproval {
    owner: string
    /** The owner approved the operator for this token alone. */
    tokenApproved: boolean
    /** The owner approved the operator for every token it holds in the collection. */
    collectionApproved: boolean
}

export interface NftCapabilities {
    schema: typeof CAPABILITIES_SCHEMA
    collection: string
    standard: "grc721"
    mode: NftMode
    holderTransfer: boolean
    marketSale: boolean
    markets: string[]
    holderBurn: boolean
    creatorRevoke: boolean
    maxSupply: bigint
    metadataMode: NftMetadataMode
    metadataFrozen: boolean
    traitsCommitted: boolean
    royaltyBPS: bigint
    /** What the ledger itself enforces. "listed_markets": a token moves only through the realms in `markets`. */
    royaltyEnforcement: NftRoyaltyEnforcement
}

const SUMMARY_KEYS = ["id", "creator", "name", "symbol", "image", "mode", "maxSupply", "sealed", "minted"] as const
const COLLECTION_KEYS = [
    "id", "grc721Id", "issuer", "creator", "originator", "pendingCreator", "name", "symbol", "description", "image", "banner", "website",
    "mode", "revocable", "maxSupply", "sealed", "minted", "totalSupply", "profileFrozen", "metadataMode", "metadataFrozen",
    "metadataRevision", "baseURI", "placeholderURI", "baseURICommitment", "committer", "provenanceHash", "traitsRoot",
    "royaltyBPS", "royalties", "markets",
] as const
const TOKEN_KEYS = ["collection", "number", "owner", "status", "uri"] as const
const HOLDING_KEYS = ["collection", "number", "uri"] as const
const APPROVAL_KEYS = ["collection", "number", "owner", "operator", "tokenApproved", "collectionApproved"] as const
const CAPABILITIES_KEYS = [
    "schema", "collection", "standard", "mode", "holderTransfer", "marketSale", "markets", "holderBurn", "creatorRevoke",
    "maxSupply", "metadataMode", "metadataFrozen", "traitsCommitted", "royaltyBPS", "royaltyEnforcement",
] as const
const utf8 = new TextEncoder()

// The realm's own rules (p/meta): a name of 1 to 32 bytes of printable text
// (Go's unicode.IsPrint: letters, marks, numbers, punctuation, symbols and the
// ASCII space) without markup characters or surrounding space, a ticker of 1 to
// 10 characters A-Z or 0-9, and an image that is empty or an ipfs:// or
// https:// URI of at most 200 printable bytes without markup characters.
const NAME = /^[\p{L}\p{M}\p{N}\p{P}\p{S} ]+$/u
const NAME_MARKUP = /[[\]()*#<>`|\\]/
const TICKER = /^[A-Z0-9]{1,10}$/
const IMAGE = /^(ipfs|https):\/\/[!#$%&*+,\-./0-9:;=?@A-Z_a-z~]+$/

/** A reveal commitment of all zeros commits to nothing, and the ledger refuses it. */
const NO_COMMITMENT = "0".repeat(64)

function imageURI(value: unknown, what: string): string {
    const uri = text(value, what)
    if (uri !== "" && (uri.length > 200 || !IMAGE.test(uri))) throw new Error(`Invalid ${what}`)
    return uri
}

/** The name, ticker and image the realm checked when the collection was created. */
function profile(row: Record<"name" | "symbol" | "image", unknown>): { name: string; symbol: string; image: string } {
    const name = text(row.name, "name")
    const nameBytes = utf8.encode(name).length
    if (nameBytes < 1 || nameBytes > 32 || !NAME.test(name) || NAME_MARKUP.test(name) || name.trim() !== name) throw new Error("Invalid name")
    const symbol = text(row.symbol, "symbol")
    if (!TICKER.test(symbol)) throw new Error("Invalid symbol")
    return { name, symbol, image: imageURI(row.image, "image") }
}

/**
 * The ledger's rule for a metadata path: IPFS, a CID, nothing a gateway could
 * resolve elsewhere (a "." or ".." segment, an escape, a query or a fragment),
 * and a URI the ledger would accept as an image, so metadata that reads as
 * fixed names fixed files.
 */
function contentAddressed(uri: string): boolean {
    return uri.startsWith("ipfs://") && uri.length > 7 && uri[7] !== "/" && !uri.includes("/.") && !/[%?#]/.test(uri)
        && uri.length <= 200 && IMAGE.test(uri)
}

/** A base URI is a directory: token n resolves to <base><n>.json. */
const baseURIValid = (uri: string) => contentAddressed(uri) && uri.endsWith("/")

function parseSummary(value: unknown): NftCollectionSummary {
    const row = record(value, "collection summary", SUMMARY_KEYS)
    const { name, symbol, image } = profile(row)
    const maxSupply = decimal(row.maxSupply, "max supply")
    const minted = decimal(row.minted, "minted count")
    if (maxSupply > 0n && minted > maxSupply) throw new Error("Inconsistent collection supply")
    return {
        id: collectionId(row.id),
        creator: address(row.creator, "creator"),
        name,
        symbol,
        image,
        mode: oneOf(row.mode, "collection mode", MODES),
        maxSupply,
        sealed: bool(row.sealed, "sealed"),
        minted,
    }
}

/** Only a royalty-protected collection names the markets allowed to move its tokens: one to five of them. */
function parseMarkets(value: unknown, mode: NftMode): string[] {
    const markets = list(value, "markets").map((market) => address(market, "market"))
    if (mode === "royalty_protected" ? markets.length < 1 || markets.length > 5 : markets.length > 0) throw new Error("Inconsistent collection markets")
    return markets
}

function parseCollection(value: unknown): NftCollection {
    const row = record(value, "collection", COLLECTION_KEYS)
    const mode = oneOf(row.mode, "collection mode", MODES)
    const revocable = bool(row.revocable, "revocable")
    if (revocable && mode !== "soulbound") throw new Error("Inconsistent collection mode")

    const maxSupply = decimal(row.maxSupply, "max supply")
    const minted = decimal(row.minted, "minted count")
    const totalSupply = decimal(row.totalSupply, "total supply")
    if ((maxSupply > 0n && minted > maxSupply) || totalSupply > minted) throw new Error("Inconsistent collection supply")

    const metadataMode = oneOf(row.metadataMode, "metadata mode", METADATA_MODES)
    const metadataFrozen = bool(row.metadataFrozen, "metadata frozen")
    const metadataRevision = decimal(row.metadataRevision, "metadata revision")
    const baseURI = text(row.baseURI, "base URI")
    const placeholderURI = text(row.placeholderURI, "placeholder URI")
    const baseURICommitment = text(row.baseURICommitment, "base URI commitment")
    const committer = metadataMode === "reveal" ? address(row.committer, "committer") : text(row.committer, "committer")
    const provenanceHash = text(row.provenanceHash, "provenance hash")
    const traitsRoot = text(row.traitsRoot, "traits root")
    const noRevealFields = placeholderURI === "" && baseURICommitment === "" && committer === "" && provenanceHash === ""
    const baseValid = baseURIValid(baseURI)
    const metadataConsistent = metadataMode === "static"
        ? metadataFrozen && baseValid && noRevealFields && metadataRevision === 0n
        : metadataMode === "mutable"
            ? baseValid && noRevealFields
            // A reveal collection serves one placeholder file until its single reveal, which sets the base URI and freezes it.
            : contentAddressed(placeholderURI) && placeholderURI.endsWith(".json")
                && HASH.test(baseURICommitment) && baseURICommitment !== NO_COMMITMENT && HASH.test(provenanceHash)
                && (baseURI === "" ? !metadataFrozen && metadataRevision === 0n : baseValid && metadataFrozen && metadataRevision === 1n)
    if (!metadataConsistent) throw new Error("Inconsistent collection metadata")
    if (traitsRoot !== "" && (!HASH.test(traitsRoot) || !metadataFrozen)) throw new Error("Inconsistent traits root")

    const royaltyBPS = decimal(row.royaltyBPS, "royalty bps")
    const royalties = list(row.royalties, "royalties").map((entry) => {
        const receiver = record(entry, "royalty receiver", ["account", "bps"])
        return { account: address(receiver.account, "royalty account"), bps: decimal(receiver.bps, "royalty receiver bps") }
    })
    if (royaltyBPS > 1000n || royalties.length > 10
        || royalties.some((receiver, index) => receiver.bps === 0n || (index > 0 && receiver.account <= royalties[index - 1].account))
        || royalties.reduce((sum, receiver) => sum + receiver.bps, 0n) !== royaltyBPS
        || (mode === "soulbound" && royalties.length > 0)
        || (mode === "royalty_protected" && royalties.length === 0)) {
        throw new Error("Inconsistent royalty terms")
    }

    const markets = parseMarkets(row.markets, mode)

    return {
        id: collectionId(row.id),
        grc721Id: text(row.grc721Id, "GRC721 ID"),
        issuer: address(row.issuer, "issuer"),
        creator: address(row.creator, "creator"),
        originator: address(row.originator, "originator"),
        pendingCreator: optionalAddress(row.pendingCreator, "pending creator"),
        ...profile(row),
        description: text(row.description, "description"),
        banner: imageURI(row.banner, "banner"),
        website: text(row.website, "website"),
        mode,
        revocable,
        maxSupply,
        sealed: bool(row.sealed, "sealed"),
        minted,
        totalSupply,
        profileFrozen: bool(row.profileFrozen, "profile frozen"),
        metadataMode,
        metadataFrozen,
        metadataRevision,
        baseURI,
        placeholderURI,
        baseURICommitment,
        committer,
        provenanceHash,
        traitsRoot,
        royaltyBPS,
        royalties,
        markets,
    }
}

function parseToken(value: unknown): NftToken {
    const row = record(value, "token", TOKEN_KEYS)
    const status = oneOf(row.status, "token status", TOKEN_STATUSES)
    const owner = status === "active" ? address(row.owner, "token owner") : text(row.owner, "token owner")
    if (status !== "active" && owner !== "") throw new Error("Inconsistent token owner")
    return { collection: text(row.collection, "token collection"), number: tokenNumber(row.number), owner, status, uri: text(row.uri, "token URI") }
}

/** Holdings come in collection then number order. */
function precedes(a: NftHolding, b: NftHolding): boolean {
    const first = BigInt(a.collection.slice(1))
    const second = BigInt(b.collection.slice(1))
    return first < second || (first === second && a.number < b.number)
}

const read = (expr: string, what: string) => readJSON(NFT_LEDGER_PATH, expr, what)

/**
 * The `size` newest collections, newest first. The ledger lists in creation
 * order by page, and a collection's ID is its place in that order (C1 first):
 * the newest ones are the tail of the last one or two pages, and every row is
 * checked to sit where its ID says.
 */
export async function listNewestCollections(size = 20): Promise<NftNewestCollections> {
    if (!Number.isSafeInteger(size) || size < 1 || size > 50) throw new Error("Invalid collection page")
    const total = await readInt(NFT_LEDGER_PATH, "Count()", "collection count")
    if (total === 0n) return { total, collections: [] }
    const width = BigInt(size)
    const first = total > width ? total - width : 0n
    const pages = [first / width, (total - 1n) / width].filter((index, at, all) => at === 0 || index !== all[0])
    // A page index can pass 2^53, so it goes into the query as text rather than through readPage.
    const rows = (await Promise.all(pages.map((index) => readSlice(NFT_LEDGER_PATH, "ListCollectionsJSON", [String(index)], size, "collection")))).flat().map(parseSummary)
    // Collections are never removed, so the pages hold at least `total` rows; one created meanwhile is left out.
    const newest = rows.slice(Number(first - pages[0] * width), Number(total - pages[0] * width))
    // Fewer rows than counted: a node that has not caught up with the count's.
    // Worth reading again, and never shown as the whole list.
    if (newest.length < Number(total - first)) throw new ReadError("Could not read every collection counted")
    if (newest.some((row, at) => row.id !== `C${first + BigInt(at) + 1n}`)) {
        throw new Error("Inconsistent collection list")
    }
    return { total, collections: newest.reverse() }
}

export async function getCollection(id: string): Promise<NftCollection> {
    const collection = parseCollection(await read(`CollectionJSON("${collectionId(id)}")`, "collection"))
    if (collection.id !== id) throw new Error("Collection does not match the request")
    return collection
}

export async function getToken(collection: string, number: bigint): Promise<NftToken> {
    const token = parseToken(await read(`TokenJSON("${collectionId(collection)}", ${natural(number, "token number")})`, "token"))
    if (token.collection !== collection || token.number !== number) throw new Error("Token does not match the request")
    return token
}

/** A collection's tokens in number order, burned and revoked ones included. */
export async function listTokens(collection: string, page = 0, size = 20): Promise<NftToken[]> {
    const rows = await readPage(NFT_LEDGER_PATH, "TokensJSON", [`"${collectionId(collection)}"`], page, size, "token")
    return rows.map((row, at) => {
        const token = parseToken(row)
        // Numbers are never reused, so a page is one unbroken run of them.
        if (token.collection !== collection || token.number !== BigInt(page) * BigInt(size) + BigInt(at) + 1n) throw new Error("Token does not match the request")
        return token
    })
}

/** The tokens an account holds across every collection: the wallet view. */
export async function listHoldings(owner: string, page = 0, size = 20): Promise<NftHolding[]> {
    const rows = await readPage(NFT_LEDGER_PATH, "HoldingsJSON", [`"${address(owner, "owner")}"`], page, size, "holding")
    const holdings = rows.map((value) => {
        const row = record(value, "holding", HOLDING_KEYS)
        return { collection: collectionId(row.collection), number: tokenNumber(row.number), uri: text(row.uri, "token URI") }
    })
    // Strictly rising, so a token listed twice is refused with the rest.
    if (holdings.some((holding, at) => at > 0 && !precedes(holdings[at - 1], holding))) throw new Error("Holdings out of order")
    return holdings
}

export async function getApproval(collection: string, number: bigint, operator: string): Promise<NftApproval> {
    const expr = `ApprovalJSON("${collectionId(collection)}", ${natural(number, "token number")}, "${address(operator, "operator")}")`
    const row = record(await read(expr, "approval"), "approval", APPROVAL_KEYS)
    if (row.collection !== collection || tokenNumber(row.number) !== number || row.operator !== operator) throw new Error("Approval does not match the request")
    return {
        owner: address(row.owner, "token owner"),
        tokenApproved: bool(row.tokenApproved, "token approved"),
        collectionApproved: bool(row.collectionApproved, "collection approved"),
    }
}

export async function getCapabilities(id: string): Promise<NftCapabilities> {
    const row = record(await read(`CapabilitiesJSON("${collectionId(id)}")`, "capabilities"), "capabilities", CAPABILITIES_KEYS)
    // Fail closed: a schema this reader was not written for is not interpreted.
    if (row.schema !== CAPABILITIES_SCHEMA) throw new Error("Unsupported capabilities schema")
    if (row.standard !== "grc721") throw new Error("Unsupported token standard")
    if (row.collection !== id) throw new Error("Capabilities do not match the request")
    const mode = oneOf(row.mode, "collection mode", MODES)
    // A holder's rights follow from the mode, as the ledger states them: only an open token moves freely,
    // a royalty-protected one moves only through a sale, and a soulbound one never moves.
    const holderTransfer = bool(row.holderTransfer, "holder transfer")
    const marketSale = bool(row.marketSale, "market sale")
    if (holderTransfer !== (mode === "open") || marketSale !== (mode !== "soulbound")) throw new Error("Inconsistent holder rights")
    const royaltyBPS = decimal(row.royaltyBPS, "royalty bps")
    const royaltyEnforcement = oneOf(row.royaltyEnforcement, "royalty enforcement", ROYALTY_ENFORCEMENTS)
    // What the ledger enforces follows from the mode and the royalty: a royalty-protected collection moves only
    // through its listed markets, an open one with royalties is paid at market sales, and no royalty leaves nothing to enforce.
    const enforced = mode === "royalty_protected" ? "listed_markets" : mode === "open" && royaltyBPS > 0n ? "market_sales" : "none"
    if (royaltyEnforcement !== enforced || (royaltyBPS === 0n) !== (enforced === "none")) throw new Error("Inconsistent royalty enforcement")
    return {
        schema: CAPABILITIES_SCHEMA,
        collection: id,
        standard: "grc721",
        mode,
        holderTransfer,
        marketSale,
        markets: parseMarkets(row.markets, mode),
        holderBurn: bool(row.holderBurn, "holder burn"),
        creatorRevoke: bool(row.creatorRevoke, "creator revoke"),
        maxSupply: decimal(row.maxSupply, "max supply"),
        metadataMode: oneOf(row.metadataMode, "metadata mode", METADATA_MODES),
        metadataFrozen: bool(row.metadataFrozen, "metadata frozen"),
        traitsCommitted: bool(row.traitsCommitted, "traits committed"),
        royaltyBPS,
        royaltyEnforcement,
    }
}
