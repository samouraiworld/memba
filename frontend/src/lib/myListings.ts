/**
 * myListings — read + cancel the connected wallet's own active marketplace
 * listings across the live lanes (NFT v3.1 + Token OTC). Read-only aggregation
 * over the existing per-lane readers, filtered client-side by seller; cancel
 * reuses the existing delist/cancel MsgCall builders + the ordinary Adena
 * broadcast (no multisig paths).
 *
 * @module lib/myListings
 */
import { fetchListingsPage } from "./marketplace/v3Reads"
import { fetchOtcListings } from "./tokenOtcApi"
import { buildDelistMsg } from "./nftMarketplace"
import { buildCancelListingMsg } from "./tokenOtc"
import { doContractBroadcast } from "./grc20"
import { NFT_MARKETPLACE_V3_PATH } from "./nftConfig"
import { isNftEnabled, isNftMarketV3Valid, isTokensEnabled, isTokenOtcValid } from "./config"

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
      }

// Paginate the global v3 listing set (there is no per-seller server query) and
// keep only this address's rows. Bounded: stop at an empty/short page or the
// safety cap so a huge global book can't spin the client forever.
const NFT_PAGE = 100
const NFT_MAX_PAGES = 20

async function fetchMyNftListings(address: string): Promise<MyListing[]> {
    const mine: MyListing[] = []
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
        if (rows.length < NFT_PAGE) break // last page
    }
    return mine
}

async function fetchMyTokenListings(address: string): Promise<MyListing[]> {
    const rows = await fetchOtcListings()
    return rows
        .filter(l => l.seller === address)
        .map(l => ({
            kind: "token" as const,
            key: `token:${l.id}`,
            id: l.id,
            symbol: l.symbol,
            unitPriceUgnot: l.expectedUnitPrice,
            amount: l.amountAvailable,
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
    const msg =
        listing.kind === "nft"
            ? buildDelistMsg(caller, NFT_MARKETPLACE_V3_PATH, listing.collectionID, listing.tokenId)
            : buildCancelListingMsg(caller, listing.id)
    const memo =
        listing.kind === "nft"
            ? `Delist NFT ${listing.collectionID} #${listing.tokenId}`
            : `Cancel token listing ${listing.id}`
    const { hash } = await doContractBroadcast([msg], memo)
    return hash
}
