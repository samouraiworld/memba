/**
 * myListings — read + cancel the connected wallet's own active marketplace
 * listings across the live lanes (NFT v3 + Token OTC). Read-only aggregation
 * over the existing per-lane readers, filtered client-side by seller; cancel
 * reuses the existing delist/cancel MsgCall builders + the ordinary Adena
 * broadcast (no multisig paths).
 *
 * @module lib/myListings
 */
import { fetchListingsPage } from "./marketplace/v3Reads"
import { fetchOtcListings } from "./tokenOtcApi"
import { routeNftV3 } from "./marketplace/router"
import { buildCancelListingMsg } from "./tokenOtc"
import { doContractBroadcast, getTokenDecimals } from "./grc20"
import { isNftEnabled, isNftMarketV3Valid, isTokensEnabled, isTokenOtcValid, GNO_RPC_URL } from "./config"

export type MyListing =
    | {
          kind: "nft"
          key: string // stable react key
          collectionID: string
          tokenId: string
          priceUgnot: number
      }
    | {
          kind: "token"
          key: string
          id: string
          symbol: string
          unitPriceUgnot: bigint
          amount: bigint
          /** T3.2: base-unit -> human conversion factor for `amount` (and to
           *  recover the per-whole-token price from `unitPriceUgnot`, which is
           *  stored per BASE UNIT on-chain). Resolved via getTokenDecimals,
           *  which never throws (falls back to 6 internally). */
          decimals: number
      }

// Paginate the global v3 listing set (there is no per-seller server query) and
// keep only this address's rows. Bounded: stop at an empty/short page or the
// safety cap so a huge global book can't spin the client forever.
const NFT_PAGE = 100
const NFT_MAX_PAGES = 20

async function fetchMyNftListings(address: string): Promise<MyListing[]> {
    const mine: MyListing[] = []
    let reachedCap = true
    for (let page = 0; page < NFT_MAX_PAGES; page++) {
        const rows = await fetchListingsPage(page * NFT_PAGE, NFT_PAGE)
        for (const l of rows) {
            if (l.seller === address) {
                mine.push({
                    kind: "nft",
                    key: `nft:${l.collectionID}/${l.tokenId}`,
                    collectionID: l.collectionID,
                    tokenId: l.tokenId,
                    priceUgnot: l.priceUgnot,
                })
            }
        }
        if (rows.length < NFT_PAGE) {
            reachedCap = false // reached the last page before the cap
            break
        }
    }
    if (reachedCap) {
        // We stopped at the page cap with a still-full last page — there may be
        // listings beyond NFT_MAX_PAGES*NFT_PAGE we didn't scan. Surface it so a
        // "missing listing" report is diagnosable rather than silent.
        console.warn(
            `[myListings] NFT listing scan hit the ${NFT_MAX_PAGES * NFT_PAGE}-row cap; ` +
                `a seller's listings beyond that are not shown.`,
        )
    }
    return mine
}

async function fetchMyTokenListings(address: string): Promise<MyListing[]> {
    const rows = await fetchOtcListings()
    const mine = rows.filter(l => l.seller === address)
    // One decimals lookup per DISTINCT symbol (cached in getTokenDecimals across
    // calls too), not one per listing.
    const symbols = [...new Set(mine.map(l => l.symbol))]
    const decimalsBySymbol = new Map<string, number>(
        // Display-only surface: a failed lookup (null) falls back to 6 HERE,
        // explicitly, at the call site — getTokenDecimals itself no longer
        // guesses (a fund-moving caller like TokenTradeModal must see the
        // null and refuse to trade, not this list-only view).
        await Promise.all(symbols.map(async (s) => [s, (await getTokenDecimals(GNO_RPC_URL, s)) ?? 6] as const)),
    )
    return mine.map(l => ({
        kind: "token" as const,
        key: `token:${l.id}`,
        id: l.id,
        symbol: l.symbol,
        unitPriceUgnot: l.expectedUnitPrice,
        amount: l.amountAvailable,
        decimals: decimalsBySymbol.get(l.symbol) ?? 6,
    }))
}

/**
 * fetchMyListings aggregates the address's active listings across whichever
 * lanes are live on this network. A single lane's read failing does not sink
 * the whole view — that lane simply contributes nothing (Promise.allSettled).
 */
export async function fetchMyListings(address: string): Promise<MyListing[]> {
    if (!address) return []
    const tasks: Promise<MyListing[]>[] = []
    if (isNftEnabled() && isNftMarketV3Valid()) tasks.push(fetchMyNftListings(address))
    if (isTokensEnabled() && isTokenOtcValid()) tasks.push(fetchMyTokenListings(address))

    const settled = await Promise.allSettled(tasks)
    const out: MyListing[] = []
    for (const r of settled) {
        if (r.status === "fulfilled") out.push(...r.value)
    }
    return out
}

/** True when at least one lane whose listings this view manages is live. */
export function anyListingLaneLive(): boolean {
    return (isNftEnabled() && isNftMarketV3Valid()) || (isTokensEnabled() && isTokenOtcValid())
}

/**
 * cancelListing broadcasts the right cancel/delist MsgCall for the listing and
 * returns the tx hash. Reuses the existing per-lane builders; single-message,
 * ordinary Adena flow (not multisig).
 */
export async function cancelListing(listing: MyListing, caller: string): Promise<string> {
    // NFT delist routes through routeNftV3 (not buildDelistMsg directly) so it
    // goes through the same isRealmValid(NFT_MARKETPLACE_V3_PATH) allowlist guard
    // every other v3 write-call-site uses — the broadcast layer doesn't check
    // engine paths, so that guard is the invariant. Token cancel has no engine
    // router; buildCancelListingMsg targets the single OTC realm.
    const msg =
        listing.kind === "nft"
            ? routeNftV3({ action: "delist", caller, collectionID: listing.collectionID, tokenId: listing.tokenId })[0]
            : buildCancelListingMsg(caller, listing.id)
    const memo =
        listing.kind === "nft"
            ? `Delist NFT ${listing.collectionID} #${listing.tokenId}`
            : `Cancel token listing ${listing.id}`
    const { hash } = await doContractBroadcast([msg], memo)
    return hash
}
