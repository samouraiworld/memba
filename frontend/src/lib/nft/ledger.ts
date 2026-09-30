/**
 * Strict reads of the NFT ledger realm. Every answer is checked against the
 * realm's JSON contract and the rules the realm itself enforces before it
 * reaches a screen: an unreadable answer throws a LedgerReadError (worth
 * retrying), and a malformed or self-contradicting one throws a plain Error
 * (the network's data cannot be used), so neither can be mistaken for an empty
 * ledger. The realm is not published on any network yet; NFT_LEDGER_PATH stays
 * out of the realm allowlist until it is.
 *
 * @module lib/nft/ledger
 */
import { parseQevalJSON, queryEval } from "../dao/shared"
import { address, bool, decimal, list, oneOf, record, text } from "./parse"

export const NFT_LEDGER_PATH = "gno.land/r/samcrew/launchpad/nft/v1"

const MODES = ["open", "royalty_protected", "soulbound"] as const

export type NftMode = (typeof MODES)[number]

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

/** The read did not reach an answer: unlike a malformed answer, it may succeed if tried again. */
export class LedgerReadError extends Error {}

const SUMMARY_KEYS = ["id", "creator", "name", "symbol", "image", "mode", "maxSupply", "sealed", "minted"] as const
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

function collectionId(value: unknown): string {
    const id = text(value, "collection ID")
    // A ledger sequence number: at most the 20 digits of a uint64.
    if (!/^C[1-9]\d{0,19}$/.test(id)) throw new Error("Invalid collection ID")
    return id
}

function parseSummary(value: unknown): NftCollectionSummary {
    const row = record(value, "collection summary", SUMMARY_KEYS)
    const name = text(row.name, "name")
    const nameBytes = utf8.encode(name).length
    if (nameBytes < 1 || nameBytes > 32 || !NAME.test(name) || NAME_MARKUP.test(name) || name.trim() !== name) throw new Error("Invalid name")
    const symbol = text(row.symbol, "symbol")
    if (!TICKER.test(symbol)) throw new Error("Invalid symbol")
    const image = text(row.image, "image")
    if (image !== "" && (image.length > 200 || !IMAGE.test(image))) throw new Error("Invalid image")
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

async function query(rpcUrl: string, expr: string, what: string): Promise<string> {
    let raw: string | null
    try {
        raw = await queryEval(rpcUrl, NFT_LEDGER_PATH, expr, true)
    } catch (cause) {
        throw new LedgerReadError(`Could not read ${what}`, { cause })
    }
    if (raw === null) throw new LedgerReadError(`Could not read ${what}`)
    return raw
}

async function page(rpcUrl: string, index: bigint, size: number): Promise<NftCollectionSummary[]> {
    const rows = list(parseQevalJSON(await query(rpcUrl, `ListCollectionsJSON(${index}, ${size})`, "collections")), "collection list")
    if (rows.length > size) throw new Error("Invalid collection list")
    return rows.map(parseSummary)
}

/**
 * The `size` newest collections, newest first. The ledger lists in creation
 * order by page, and a collection's ID is its place in that order (C1 first):
 * the newest ones are the tail of the last one or two pages, and every row is
 * checked to sit where its ID says.
 */
export async function listNewestCollections(rpcUrl: string, size = 20): Promise<NftNewestCollections> {
    if (!Number.isSafeInteger(size) || size < 1 || size > 50) throw new Error("Invalid collection page")
    const count = /^\((\d+) int64\)$/.exec((await query(rpcUrl, "Count()", "collection count")).trim())
    if (!count) throw new Error("Invalid collection count")
    const total = decimal(count[1], "collection count")
    if (total === 0n) return { total, collections: [] }
    const width = BigInt(size)
    const first = total > width ? total - width : 0n
    const pages = [first / width, (total - 1n) / width].filter((index, at, all) => at === 0 || index !== all[0])
    const rows = (await Promise.all(pages.map((index) => page(rpcUrl, index, size)))).flat()
    // Collections are never removed, so the pages hold at least `total` rows; one created meanwhile is left out.
    const newest = rows.slice(Number(first - pages[0] * width), Number(total - pages[0] * width))
    // Fewer rows than counted: a node that has not caught up with the count's.
    // Worth reading again, and never shown as the whole list.
    if (newest.length < Number(total - first)) throw new LedgerReadError("Could not read every collection counted")
    if (newest.some((row, at) => row.id !== `C${first + BigInt(at) + 1n}`)) {
        throw new Error("Inconsistent collection list")
    }
    return { total, collections: newest.reverse() }
}
