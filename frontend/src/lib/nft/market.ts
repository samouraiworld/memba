/**
 * Strict reads of the NFT market realm: fixed-price listings, funded offers,
 * and how a price splits between the seller, the treasury and the royalty
 * receivers. The realm keeps open orders only: a closed listing or offer is
 * deleted and its history is in events, so an order that is read is open.
 * Orders come and go between two reads, so lists are read by cursor, not by
 * page: each read starts after the last order already read.
 * Every answer is checked against the realm's JSON contract and its own rules
 * before it reaches a screen; an unreadable, malformed or self-contradicting
 * answer throws, so a failed read is never an empty market. The realm is not
 * published on any network yet; NFT_MARKET_PATH stays out of the realm
 * allowlist until it is.
 *
 * @module lib/nft/market
 */
import { address, bool, collectionId, currencyKey, decimal, decimalOrUnset, list, oneOf, optionalAddress, record, text, tokenNumber } from "./parse"
import { natural, readInt, readJSON, readSlice } from "./read"

export const NFT_MARKET_PATH = "gno.land/r/samcrew/launchpad/market/v1"

const OFFER_KINDS = ["token", "collection", "trait"] as const
/** The realm's hard cap on the protocol fee of a sale. */
const MAX_FEE_BPS = 200n
/** "<type>=<value>" in at most 100 bytes: one "=", neither side empty, and no "|", which separates the fields of a trait leaf. */
const TRAIT = /^[^=|]+=[^=|]+$/

export type NftOfferKind = (typeof OFFER_KINDS)[number]

/** How a price is divided at a sale. The protocol fee and the royalties come out of the price, never on top. */
export interface NftSplit {
    seller: bigint
    fee: bigint
    royalties: { account: string; amount: bigint }[]
}

/** What a listing and an offer share: an open, priced, dated order on a collection. Times are Unix seconds. */
interface NftOrder {
    id: string
    collection: string
    price: bigint
    currency: string
    createdAt: bigint
    expiresAt: bigint
    /** Protocol fee, pinned when the order was signed. */
    feeBPS: bigint
    split: NftSplit
}

/** One token offered at a fixed price. The seller keeps the token until it is bought. */
export interface NftListing extends NftOrder {
    number: bigint
    seller: string
    /** Whether it can be bought right now: not expired, and the seller still owns the token and approves the market. */
    buyable: boolean
}

/**
 * A bid whose full price sits in the realm until it is accepted, cancelled or
 * refunded. It can be past its expiry: it then only waits for its refund.
 */
export interface NftOffer extends NftOrder {
    kind: NftOfferKind
    /** Token offers only; zero otherwise. */
    number: bigint
    /** Trait offers only: "<type>=<value>"; empty otherwise. */
    trait: string
    buyer: string
}

export interface NftMarketTerms {
    /** The protocol fee a new order would pin; null while it is not set. */
    feeBPS: bigint | null
    maxFeeBPS: bigint
    /** Empty until a treasury is named. */
    treasury: string
    /** Null while no order can be placed at the current fee. */
    split: NftSplit | null
}

const ORDER_KEYS = ["id", "collection", "price", "currency", "createdAt", "expiresAt", "feeBPS", "split"] as const
const LISTING_KEYS = [...ORDER_KEYS, "number", "seller", "buyable"] as const
const OFFER_KEYS = [...ORDER_KEYS, "kind", "number", "trait", "buyer"] as const
const TERMS_KEYS = ["feeBPS", "maxFeeBPS", "treasury", "split"] as const

/** The split of `price` at `feeBPS`: the fee is that rate rounded down, and the parts add up to the price exactly. */
function parseSplit(value: unknown, price: bigint, feeBPS: bigint): NftSplit {
    const row = record(value, "split", ["seller", "fee", "royalties"])
    const split = {
        seller: decimal(row.seller, "seller proceeds"),
        fee: decimal(row.fee, "protocol fee"),
        royalties: list(row.royalties, "royalty payouts").map((entry) => {
            const payout = record(entry, "royalty payout", ["account", "amount"])
            return { account: address(payout.account, "royalty account"), amount: decimal(payout.amount, "royalty amount") }
        }),
    }
    const paid = split.seller + split.fee + split.royalties.reduce((sum, payout) => sum + payout.amount, 0n)
    if (split.fee !== price * feeBPS / 10000n || paid !== price) throw new Error("Inconsistent split")
    return split
}

/** "L<n>" names a listing and "O<n>" an offer; the realm issues at most 9,999,999,999 of each. */
function orderId(value: unknown, prefix: "L" | "O"): string {
    if (typeof value !== "string" || value[0] !== prefix || !/^[1-9]\d{0,9}$/.test(value.slice(1))) throw new Error(`Invalid ${prefix === "L" ? "listing" : "offer"} ID`)
    return value
}

function parseOrder(row: Record<(typeof ORDER_KEYS)[number], unknown>, prefix: "L" | "O"): NftOrder {
    const price = decimal(row.price, "price")
    const createdAt = decimal(row.createdAt, "creation time")
    const expiresAt = decimal(row.expiresAt, "expiry time")
    const feeBPS = decimal(row.feeBPS, "fee bps")
    if (price === 0n || expiresAt <= createdAt || feeBPS > MAX_FEE_BPS) throw new Error("Inconsistent order terms")
    return { id: orderId(row.id, prefix), collection: collectionId(row.collection), price, currency: currencyKey(row.currency), createdAt, expiresAt, feeBPS, split: parseSplit(row.split, price, feeBPS) }
}

function parseListing(value: unknown): NftListing {
    const row = record(value, "listing", LISTING_KEYS)
    return { ...parseOrder(row, "L"), number: tokenNumber(row.number), seller: address(row.seller, "seller"), buyable: bool(row.buyable, "buyable") }
}

function parseOffer(value: unknown): NftOffer {
    const row = record(value, "offer", OFFER_KEYS)
    const kind = oneOf(row.kind, "offer kind", OFFER_KINDS)
    const number = decimal(row.number, "token number")
    const trait = text(row.trait, "trait")
    // What an offer is for is named once: a token by its number, a trait by its text, a collection by neither.
    const consistent = kind === "token"
        ? number > 0n && trait === ""
        : kind === "collection"
            ? number === 0n && trait === ""
            : number === 0n && TRAIT.test(trait) && new TextEncoder().encode(trait).length <= 100
    if (!consistent) throw new Error("Inconsistent offer target")
    return { ...parseOrder(row, "O"), kind, number, trait, buyer: address(row.buyer, "buyer") }
}

const read = (rpcUrl: string, expr: string, what: string) => readJSON(rpcUrl, NFT_MARKET_PATH, expr, what)

/** Order IDs are issued in sequence, so creation order is ID order. */
const oldestFirst = (order: { id: string }) => BigInt(order.id.slice(1))
const newestFirst = (order: { id: string }) => -oldestFirst(order)

/** Where a list is read from: `arg` goes into the query, and every order read ranks strictly past `rank`. */
interface Cursor {
    arg: string
    rank: bigint | null
}

/** The ID of the last order already read, or "" to read from the beginning. `rank` is the order of the list it points into. */
function cursor(id: string, prefix: "L" | "O", rank: (order: { id: string }) => bigint): Cursor {
    return id === "" ? { arg: '""', rank: null } : { arg: `"${orderId(id, prefix)}"`, rank: rank({ id }) }
}

/**
 * One slice of listings or offers. `rank` is what the realm sorts the list by
 * and must rise strictly, so no order appears twice. Every order lies past the
 * cursor, so nothing already read comes back, and `belongs` is what a filtered
 * list was filtered on, so no order is shown where it does not belong.
 */
async function readOrders<T extends NftOrder>(
    rpcUrl: string, view: string, filter: readonly string[], from: Cursor, size: number, what: string,
    parse: (value: unknown) => T, rank: (order: T) => bigint, belongs: (order: T) => boolean = () => true,
): Promise<T[]> {
    const orders = (await readSlice(rpcUrl, NFT_MARKET_PATH, view, [...filter, from.arg], size, what)).map(parse)
    const past = from.rank
    if (!orders.every((order) => belongs(order) && (past === null || rank(order) > past))) throw new Error(`Mismatched ${what} list`)
    if (orders.some((order, index) => index > 0 && rank(order) <= rank(orders[index - 1]))) throw new Error(`Unordered ${what} list`)
    return orders
}

/** An open listing, or null when it is closed or never existed. */
export async function getListing(rpcUrl: string, id: string): Promise<NftListing | null> {
    const value = await read(rpcUrl, `ListingJSON("${orderId(id, "L")}")`, "listing")
    if (value === null) return null
    const listing = parseListing(value)
    if (listing.id !== id) throw new Error("Listing does not match the request")
    return listing
}

/** The open listing of a token, or null when it has none. */
export async function getTokenListing(rpcUrl: string, collection: string, number: bigint): Promise<NftListing | null> {
    const value = await read(rpcUrl, `TokenListingJSON("${collectionId(collection)}", ${natural(number, "token number")})`, "listing")
    if (value === null) return null
    const listing = parseListing(value)
    if (listing.collection !== collection || listing.number !== number) throw new Error("Listing does not match the request")
    return listing
}

/** Every open listing, newest first, below the listing `before` ("" reads from the newest). */
export async function listListings(rpcUrl: string, before = "", size = 20): Promise<NftListing[]> {
    return readOrders(rpcUrl, "ListingsJSON", [], cursor(before, "L", newestFirst), size, "listing", parseListing, newestFirst)
}

/** A collection's open listings in token number order, after the token `afterNumber` (0 reads from the first). */
export async function listCollectionListings(rpcUrl: string, collection: string, afterNumber = 0n, size = 20): Promise<NftListing[]> {
    const filter = [`"${collectionId(collection)}"`]
    const from = { arg: `${natural(afterNumber, "token number")}`, rank: afterNumber }
    return readOrders(rpcUrl, "CollectionListingsJSON", filter, from, size, "listing", parseListing,
        (listing) => listing.number, (listing) => listing.collection === collection)
}

/** An account's open listings, oldest first, after the listing `afterId` ("" reads from the oldest). */
export async function listSellerListings(rpcUrl: string, seller: string, afterId = "", size = 20): Promise<NftListing[]> {
    return readOrders(rpcUrl, "SellerListingsJSON", [`"${address(seller, "seller")}"`], cursor(afterId, "L", oldestFirst), size, "listing", parseListing,
        oldestFirst, (listing) => listing.seller === seller)
}

/** An open offer, or null when it is closed or never existed. */
export async function getOffer(rpcUrl: string, id: string): Promise<NftOffer | null> {
    const value = await read(rpcUrl, `OfferJSON("${orderId(id, "O")}")`, "offer")
    if (value === null) return null
    const offer = parseOffer(value)
    if (offer.id !== id) throw new Error("Offer does not match the request")
    return offer
}

/** Every open offer, newest first, below the offer `before` ("" reads from the newest). */
export async function listOffers(rpcUrl: string, before = "", size = 20): Promise<NftOffer[]> {
    return readOrders(rpcUrl, "OffersJSON", [], cursor(before, "O", newestFirst), size, "offer", parseOffer, newestFirst)
}

/** A collection's open offers of every kind, oldest first, after the offer `afterId` ("" reads from the oldest). */
export async function listCollectionOffers(rpcUrl: string, collection: string, afterId = "", size = 20): Promise<NftOffer[]> {
    return readOrders(rpcUrl, "CollectionOffersJSON", [`"${collectionId(collection)}"`], cursor(afterId, "O", oldestFirst), size, "offer", parseOffer,
        oldestFirst, (offer) => offer.collection === collection)
}

/** An account's open offers, oldest first, after the offer `afterId` ("" reads from the oldest). */
export async function listBuyerOffers(rpcUrl: string, buyer: string, afterId = "", size = 20): Promise<NftOffer[]> {
    return readOrders(rpcUrl, "BuyerOffersJSON", [`"${address(buyer, "buyer")}"`], cursor(afterId, "O", oldestFirst), size, "offer", parseOffer,
        oldestFirst, (offer) => offer.buyer === buyer)
}

/** What a sale costs now, and how a price would split for a collection. */
export async function getMarketTerms(rpcUrl: string, collection: string, price: bigint): Promise<NftMarketTerms> {
    const row = record(await read(rpcUrl, `TermsJSON("${collectionId(collection)}", ${natural(price, "price")})`, "market terms"), "market terms", TERMS_KEYS)
    const feeBPS = decimalOrUnset(row.feeBPS, "fee bps")
    const maxFeeBPS = decimal(row.maxFeeBPS, "maximum fee bps")
    // The realm quotes a split only at a fee a new order could pin.
    const quoted = feeBPS !== null && feeBPS <= maxFeeBPS
    if (maxFeeBPS > MAX_FEE_BPS || quoted !== (row.split !== null)) throw new Error("Inconsistent market terms")
    return { feeBPS, maxFeeBPS, treasury: optionalAddress(row.treasury, "treasury"), split: quoted ? parseSplit(row.split, price, feeBPS) : null }
}

/** The total the realm holds for open offers in a currency. */
export async function escrowOf(rpcUrl: string, currency: string): Promise<bigint> {
    return readInt(rpcUrl, NFT_MARKET_PATH, `EscrowOf("${currencyKey(currency)}")`, "escrow")
}
