/**
 * Strict reads of the NFT drops realm: the mint stages of a collection, what
 * creating a collection and minting cost, and what a wallet or a gate token
 * has already used. Every answer is checked against the realm's JSON contract
 * and its own rules before it reaches a screen; an unreadable, refused,
 * malformed or self-contradicting answer throws (see lib/nft/read). The realm
 * is not published on any network yet; NFT_DROPS_PATH stays out of the realm
 * allowlist until it is.
 *
 * @module lib/nft/drops
 */
import { HASH, address, bool, collectionId, currencyKey, decimal, decimalOrUnset, list, oneOf, optionalAddress, record, text } from "./parse"
import { natural, readBool, readInt, readJSON } from "./read"

export const NFT_DROPS_PATH = "gno.land/r/samcrew/launchpad/drops/v1"

const STAGE_KINDS = ["fixed", "allowlist", "holder", "dutch"] as const
const MAX_STAGES = 10
/** The realm's hard cap on the protocol fee of a mint. */
const MAX_FEE_BPS = 500n

export type NftStageKind = (typeof STAGE_KINDS)[number]

/** One mint window of a collection, open during [start, end). Times are Unix seconds. A stage ended at its start has an empty window. */
export interface NftStage {
    index: number
    kind: NftStageKind
    start: bigint
    end: bigint
    /** Whether the window was open at the block the answer was read from. */
    open: boolean
    /** Per token; for a dutch stage, the price at the start. */
    price: bigint
    /** Dutch only: the price reached at the end. */
    floor: bigint
    /** What a mint would pay now. It differs from the price only while a dutch stage is open. */
    currentPrice: bigint
    currency: string
    /** Protocol fee on each mint, pinned when the creator scheduled the stage. */
    feeBPS: bigint
    /** Zero means no cap beyond the collection's. */
    supplyCap: bigint
    /** The most one wallet may mint. Zero on an allowlist stage, where each address has its own allowance. */
    perWallet: bigint
    /** Allowlist only: the Merkle root of the allowed addresses. */
    root: string
    /** Holder only: the collection whose tokens each allow one mint. */
    gate: string
    /** Holder only: only the gate tokens numbered up to this one, all minted when the stage was scheduled, allow a mint. */
    gateLimit: bigint
    minted: bigint
}

export interface NftDropTerms {
    currency: string
    /** Null while collections cannot be created in this currency. */
    collectionFee: bigint | null
    /** The protocol fee a new stage would pin; null while it is not set. */
    primaryFeeBPS: bigint | null
    maxPrimaryFeeBPS: bigint
    /** Empty until a treasury is named. */
    treasury: string
}

const STAGE_KEYS = [
    "index", "kind", "start", "end", "open", "price", "floor", "currentPrice", "currency", "feeBPS", "supplyCap", "perWallet",
    "root", "gate", "gateLimit", "minted",
] as const
const TERMS_KEYS = ["currency", "collectionFee", "primaryFeeBPS", "maxPrimaryFeeBPS", "treasury"] as const

function parseStage(value: unknown, position: number): NftStage {
    const row = record(value, "stage", STAGE_KEYS)
    // The index is the one integer the realm writes as a JSON number: it is a position, not an int64.
    if (row.index !== position) throw new Error("Invalid stage index")
    const kind = oneOf(row.kind, "stage kind", STAGE_KINDS)
    const start = decimal(row.start, "stage start")
    const end = decimal(row.end, "stage end")
    const open = bool(row.open, "stage open")
    // Ending a stage sets its end to that moment, which can be its start: an empty window, never open.
    if (end < start || (end === start && open)) throw new Error("Inconsistent stage window")
    const price = decimal(row.price, "stage price")
    const floor = decimal(row.floor, "stage floor")
    const currentPrice = decimal(row.currentPrice, "current price")
    const perWallet = decimal(row.perWallet, "wallet limit")
    const root = text(row.root, "allowlist root")
    const gate = kind === "holder" ? collectionId(row.gate) : text(row.gate, "gate collection")
    const gateLimit = decimal(row.gateLimit, "gate limit")
    if (kind !== "holder" && gateLimit !== 0n) throw new Error("Inconsistent stage terms")
    // A field a kind does not use is zero or empty, so a stage reads the same to everyone.
    const walletLimited = perWallet > 0n && root === ""
    const consistent = kind === "fixed"
        ? walletLimited && floor === 0n && gate === ""
        : kind === "allowlist"
            ? perWallet === 0n && floor === 0n && HASH.test(root) && gate === ""
            : kind === "holder"
                ? walletLimited && floor === 0n
                : walletLimited && floor < price && gate === ""
    if (!consistent) throw new Error("Inconsistent stage terms")
    // Only an open dutch stage has moved off its starting price, and never below its floor.
    if (currentPrice !== price && !(kind === "dutch" && open && currentPrice >= floor && currentPrice < price)) throw new Error("Inconsistent stage price")

    const feeBPS = decimal(row.feeBPS, "stage fee bps")
    if (feeBPS > MAX_FEE_BPS) throw new Error("Inconsistent stage fee")
    const supplyCap = decimal(row.supplyCap, "stage supply cap")
    const minted = decimal(row.minted, "stage minted count")
    if (supplyCap > 0n && minted > supplyCap) throw new Error("Inconsistent stage supply")

    return { index: position, kind, start, end, open, price, floor, currentPrice, currency: currencyKey(row.currency), feeBPS, supplyCap, perWallet, root, gate, gateLimit, minted }
}

/** A collection's mint stages in index order; none yet is an empty list. */
export async function listStages(collection: string): Promise<NftStage[]> {
    const rows = list(await readJSON(NFT_DROPS_PATH, `StagesJSON("${collectionId(collection)}")`, "stages"), "stage list")
    if (rows.length > MAX_STAGES) throw new Error("Invalid stage list")
    const stages = rows.map(parseStage)
    // No two windows overlap, so at most one stage is open at a time.
    if (stages.some((stage, index) => stages.some((other, at) => at > index && stage.start < other.end && other.start < stage.end))) throw new Error("Overlapping stages")
    return stages
}

/** What creating a collection and scheduling a stage cost now in a currency. */
export async function getDropTerms(currency: string): Promise<NftDropTerms> {
    const row = record(await readJSON(NFT_DROPS_PATH, `TermsJSON("${currencyKey(currency)}")`, "drop terms"), "drop terms", TERMS_KEYS)
    if (row.currency !== currency) throw new Error("Drop terms do not match the request")
    const primaryFeeBPS = decimalOrUnset(row.primaryFeeBPS, "primary fee bps")
    const maxPrimaryFeeBPS = decimal(row.maxPrimaryFeeBPS, "maximum primary fee bps")
    if (maxPrimaryFeeBPS > MAX_FEE_BPS || (primaryFeeBPS !== null && primaryFeeBPS > maxPrimaryFeeBPS)) throw new Error("Inconsistent drop fee")
    return {
        currency,
        collectionFee: decimalOrUnset(row.collectionFee, "collection fee"),
        primaryFeeBPS,
        maxPrimaryFeeBPS,
        treasury: optionalAddress(row.treasury, "treasury"),
    }
}

const stageArgs = (collection: string, index: number) => `"${collectionId(collection)}", ${natural(index, "stage index")}`

/**
 * How many tokens an account has minted in a stage. The realm answers 0 for a
 * stage that does not exist, so a caller reads the stage (listStages) first
 * and asks only about one it found.
 */
export async function mintedBy(collection: string, index: number, who: string): Promise<bigint> {
    return readInt(NFT_DROPS_PATH, `MintedBy(${stageArgs(collection, index)}, "${address(who, "minter")}")`, "minted count")
}

/** Whether a gate token has already been used for a mint in a holder stage. */
export async function gateUsed(collection: string, index: number, gateNumber: bigint): Promise<boolean> {
    return readBool(NFT_DROPS_PATH, `GateUsed(${stageArgs(collection, index)}, ${natural(gateNumber, "gate token number")})`, "gate token use")
}
