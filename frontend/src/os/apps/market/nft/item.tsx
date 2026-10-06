/**
 * Market NFT lane, one token's trade panel (`nfts/c/<id>/<number>`): its open
 * listing with the split the realm computed for it, the offers that can apply
 * to it, and the rule for who closes an order, with a link to the token's
 * page in the NFT app. A member buys a listing priced in GNOT here, and its
 * seller cancels it; a guest is asked to connect only when buying.
 *
 * @module os/apps/market/nft/item
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { useNow } from "../../../../hooks/home/useNow"
import { networkGasPriceFresh } from "../../../../lib/grc20"
import { formatAmount } from "../../../../lib/nft/format"
import { getTokenListing, type NftListing, type NftOffer } from "../../../../lib/nft/market"
import { ReadError, RealmRefusedError } from "../../../../lib/nft/read"
import { buyBlocker } from "../../../../lib/nft/trade"
import { TokenLaunchpadReadError } from "../../../../lib/tokenLaunchpadClient"
import { laneClosedReason, readActionStatus } from "../../../../lib/tokenLaunchpadConfigClient"
import { useSigner } from "../../../sign/signerContext"
import type { OsSession } from "../../../shell/useOsSession"
import { CardGrid, Empty, Loading, Pill } from "../../../kit"
import { CollectionName, DepositRule, OfferCard, OrderList, Payouts, Price, ReadFailure, TokenArt } from "./orders"
import { ORDER_DEPOSIT, isExpired, useCollectionOffers, utc, type LaneProps } from "./reads"
import { buyRequest, cancelListingRequest } from "./tradeRequest"

/** A failed check before the review, in words a member can act on. */
function reason(err: unknown): string {
    if (err instanceof ReadError) return "The network could not be read. Try again in a moment."
    if (err instanceof RealmRefusedError) return "The network refused this read. Refresh the listing."
    if (err instanceof TokenLaunchpadReadError) {
        if (err.code === "realm_error") return "The market's configuration refused this read. Refresh the listing."
        if (err.code === "invalid_response") return "The market's configuration answered in a form this version does not read."
        return "The network could not be read. Try again in a moment."
    }
    return err instanceof Error ? err.message : String(err)
}

/**
 * Buy the listing, or cancel it for its seller. The fee and, for a purchase,
 * the market lane are read at this click, so a paused market is said here
 * rather than in the sheet.
 */
function ListingAction({ lane, session, listing }: { lane: LaneProps; session: OsSession; listing: NftListing }) {
    const signer = useSigner()
    const client = useQueryClient()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")
    const alive = useRef(true)
    useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
    const viewer = session.status === "member" ? session.address : ""
    const mine = viewer !== "" && viewer === listing.seller
    const now = useNow(60_000)
    // "Not buyable now" is already on the listing; only a reason it does not give is said here.
    if (!mine && (!listing.buyable || isExpired(listing, now))) return null
    const blocker = mine ? "" : buyBlocker(listing, viewer)
    if (blocker) return <p className="os-sub">{blocker}</p>

    const act = async () => {
        if (session.status !== "member") { session.openConnect(); return }
        setError("")
        setBusy(true)
        try {
            const price = await networkGasPriceFresh()
            if (!mine) {
                const status = await readActionStatus(session.network.key, "nft_market", listing.currency)
                if (!status.open) throw new Error(laneClosedReason(status, "Trading"))
            }
            if (!alive.current) return
            const request = mine ? cancelListingRequest : buyRequest
            signer.sign(request({
                listing, caller: session.address, networkKey: session.network.key, chainId: lane.chainId, price,
                onSettled: (outcome) => {
                    if (outcome !== "confirmed" && outcome !== "submitted") return
                    void client.invalidateQueries({ queryKey: ["nft", "market"] })
                    void client.invalidateQueries({ queryKey: ["nft", "ledger"] })
                },
            }))
        } catch (err) {
            if (alive.current) setError(reason(err))
        } finally {
            if (alive.current) setBusy(false)
        }
    }
    const label = mine ? "Cancel listing" : viewer ? `Buy for ${formatAmount(listing.price, listing.currency)}` : "Connect to buy"
    return (
        <div className="os-stack os-tight">
            <div className="os-row"><button type="button" className={mine ? "os-btn os-quiet" : "os-btn"} disabled={busy} onClick={() => void act()}>{busy ? "Checking…" : label}</button></div>
            {error && <p className="os-note os-warn" role="alert">{error}</p>}
        </div>
    )
}

function Listing({ lane, session, listing }: { lane: LaneProps; session: OsSession; listing: NftListing }) {
    const now = useNow(60_000)
    const expired = isExpired(listing, now)
    return (
        <div className="os-stack os-tight">
            <div className="os-row">
                <Price order={listing} />
                {listing.buyable && !expired ? <Pill tone="ok">Buyable now</Pill> : <Pill tone="warn">Not buyable now</Pill>}
            </div>
            <DepositRule order="listing" />
            <span className="os-sub">Listed {utc(listing.createdAt)} · {expired ? "expired" : "expires"} {utc(listing.expiresAt)}</span>
            <Payouts order={listing} seller={listing.seller} />
            <ListingAction lane={lane} session={session} listing={listing} />
        </div>
    )
}

export function ItemTrade({ lane, session, collection, number }: { lane: LaneProps; session: OsSession; collection: string; number: bigint }) {
    const listing = useQuery({
        queryKey: ["nft", "market", lane.chainId, "token-listing", collection, number.toString()],
        queryFn: () => getTokenListing(collection, number),
        staleTime: 30_000, retry: false,
    })
    const offers = useCollectionOffers(lane.chainId, collection)
    const now = useNow(60_000)
    const applies = (offer: NftOffer) => offer.kind !== "token" || offer.number === number
    // Expired offers wait for their refund: listed apart, among those read so far, and never as applying.
    const expired = (offers.data?.pages ?? []).flat().filter((offer) => applies(offer) && isExpired(offer, now))
    return (
        <>
            <div className="os-row">
                <h3 className="os-h os-flush os-grow" style={{ overflowWrap: "anywhere" }}><CollectionName chainId={lane.chainId} id={collection} /> #{number.toString()}</h3>
                <button type="button" className="os-btn os-quiet" onClick={() => lane.openNft({ kind: "token", collection, number })}>Item page</button>
            </div>
            <div style={{ maxWidth: 240 }}><TokenArt chainId={lane.chainId} collection={collection} number={number} alt="" /></div>
            <section aria-label="Listing">
                <h4 className="os-h">Listing</h4>
                {listing.isPending ? <Loading label="Reading the listing…" />
                    : listing.isError ? <ReadFailure error={listing.error} what="listing" retry={() => void listing.refetch()} />
                    : listing.data === null ? <Empty title="This token is not listed." />
                    : <Listing lane={lane} session={session} listing={listing.data} />}
            </section>
            <section aria-label="Offers for this token">
                <h4 className="os-h">Offers</h4>
                <OrderList orders={offers} what="offers" empty="No open offer applies to this token." keep={(offer) => applies(offer) && !isExpired(offer, now)}>
                    {(offer) => <OfferCard key={offer.id} offer={offer} lane={lane} forToken />}
                </OrderList>
                {expired.length > 0 && <>
                    <h5 className="os-h">Expired</h5>
                    <CardGrid>{expired.map((offer) => <OfferCard key={offer.id} offer={offer} lane={lane} forToken />)}</CardGrid>
                </>}
            </section>
            <p className="os-note" role="note">
                An open listing or offer holds a storage deposit ({ORDER_DEPOSIT}), and the chain pays it to whoever closes the order: the buyer at a sale, the seller who accepts an offer, the owner who cancels.
                For a week after an order expires only its owner can close it; after that anyone can. Anyone can clear at once a listing whose seller no longer holds the token. An expired offer's escrow always goes back to its buyer.
            </p>
        </>
    )
}
