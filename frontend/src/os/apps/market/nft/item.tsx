/**
 * Market NFT lane, one token's trade panel (`nfts/c/<id>/<number>`): its open
 * listing with the split the realm computed for it, the offers that can apply
 * to it, and the rule for who closes an order, with a link to the token's
 * page in the NFT app. A member buys a listing priced in GNOT here and makes
 * an offer for the token; its seller cancels the listing, the token's holder
 * lists it (or replaces its listing) and accepts an offer, and an offer's
 * buyer cancels it. A guest is asked to connect only when it acts.
 *
 * @module os/apps/market/nft/item
 */
import { useQuery } from "@tanstack/react-query"
import { useNow } from "../../../../hooks/home/useNow"
import { networkGasPriceFresh } from "../../../../lib/grc20"
import { formatAmount } from "../../../../lib/nft/format"
import { getTokenListing, type NftListing, type NftOffer } from "../../../../lib/nft/market"
import { buyBlocker } from "../../../../lib/nft/trade"
import { laneClosedReason, readActionStatus } from "../../../../lib/tokenLaunchpadConfigClient"
import type { OsSession } from "../../../shell/useOsSession"
import { CardGrid, Empty, Loading, Pill } from "../../../kit"
import { ActionButton, OrderForm } from "./actions"
import { quoteOrder, tradeBlocker, useSignAction, useToken } from "./signing"
import { MakeOfferForm, OfferAction } from "./offerActions"
import { CollectionName, DepositRule, OfferCard, OrderList, Payouts, Price, ReadFailure, TokenArt } from "./orders"
import { ORDER_DEPOSIT, isExpired, useCollection, useCollectionOffers, utc, type LaneProps } from "./reads"
import { buyRequest, cancelListingRequest, listRequest } from "./tradeRequest"

/**
 * Buy the listing, or cancel it for its seller. The fee and, for a purchase,
 * the market lane are read at this click, so a paused market is said here
 * rather than in the sheet.
 */
function ListingAction({ lane, session, listing }: { lane: LaneProps; session: OsSession; listing: NftListing }) {
    const action = useSignAction(session)
    const viewer = session.status === "member" ? session.address : ""
    const mine = viewer !== "" && viewer === listing.seller
    const now = useNow(60_000)
    // "Not buyable now" is already on the listing; only a reason it does not give is said here.
    if (!mine && (!listing.buyable || isExpired(listing, now))) return null
    const blocker = mine ? "" : buyBlocker(listing, viewer)
    if (blocker) return <p className="os-sub">{blocker}</p>
    const go = () => void action.run(async (caller) => {
        const gas = await networkGasPriceFresh()
        if (!mine) {
            const status = await readActionStatus(session.network.key, "nft_market", listing.currency)
            if (!status.open) throw new Error(laneClosedReason(status, "Trading"))
        }
        const request = mine ? cancelListingRequest : buyRequest
        return request({ listing, caller, networkKey: session.network.key, chainId: lane.chainId, price: gas, onSettled: action.afterTrade })
    })
    const label = mine ? "Cancel listing" : viewer ? `Buy for ${formatAmount(listing.price, listing.currency)}` : "Connect to buy"
    return <ActionButton label={label} quiet={mine} action={action} onClick={go} />
}

/**
 * List the token for sale, shown to its holder only. The fee, the market
 * lane and the market's terms for this price are read at this click; the
 * sheet shows where the price would go at a sale.
 */
function SellForm({ lane, session, collection, number, listing }: { lane: LaneProps; session: OsSession; collection: string; number: bigint; listing: NftListing | null }) {
    const action = useSignAction(session)
    const replaces = listing !== null && session.status === "member" && listing.seller === session.address ? listing.id : null
    const submit = (price: bigint, expiresAt: bigint) => void action.run(async (caller) => {
        const quote = await quoteOrder(session.network.key, collection, price, "listing")
        return listRequest({
            collection, number, price, expiresAt, feeBPS: quote.feeBPS, split: quote.split, replaces,
            caller, networkKey: session.network.key, chainId: lane.chainId, gas: quote.gas, onSettled: action.afterTrade,
        })
    })
    return (
        <OrderForm label={replaces ? "Replace listing" : "List for sale"} action={action} submit={submit}>
            {replaces && <p className="os-sub">A new listing closes your listing {replaces}.</p>}
        </OrderForm>
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
    const token = useToken(lane.chainId, collection, number)
    const info = useCollection(lane.chainId, collection)
    const viewer = session.status === "member" ? session.address : ""
    const active = token.data?.status === "active"
    const holder = active && viewer !== "" && token.data?.owner === viewer
    const blocker = info.data ? tradeBlocker(info.data) : null
    const myListing = holder && listing.data?.seller === viewer ? listing.data.id : null
    const now = useNow(60_000)
    const applies = (offer: NftOffer) => offer.kind !== "token" || offer.number === number
    // Expired offers wait for their refund: listed apart, among those read so far, and never as applying.
    const expired = (offers.data?.pages ?? []).flat().filter((offer) => applies(offer) && isExpired(offer, now))
    const sell = holder && !blocker ? { number, listing: myListing } : null
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
            {holder && listing.isSuccess && blocker !== null && (
                <section aria-label="Sell this token">
                    <h4 className="os-h">Sell</h4>
                    {blocker ? <p className="os-sub">{blocker}</p> : <SellForm lane={lane} session={session} collection={collection} number={number} listing={listing.data} />}
                </section>
            )}
            {active && !holder && blocker !== null && (
                <section aria-label="Make an offer for this token">
                    <h4 className="os-h">Make an offer</h4>
                    {blocker ? <p className="os-sub">{blocker}</p> : <MakeOfferForm lane={lane} session={session} kind="token" collection={collection} number={number} />}
                </section>
            )}
            <section aria-label="Offers for this token">
                <h4 className="os-h">Offers</h4>
                <OrderList orders={offers} what="offers" empty="No open offer applies to this token." keep={(offer) => applies(offer) && !isExpired(offer, now)}>
                    {(offer) => <OfferCard key={offer.id} offer={offer} lane={lane} forToken action={<OfferAction lane={lane} session={session} offer={offer} sell={sell} />} />}
                </OrderList>
                {expired.length > 0 && <>
                    <h5 className="os-h">Expired</h5>
                    <CardGrid>{expired.map((offer) => <OfferCard key={offer.id} offer={offer} lane={lane} forToken action={<OfferAction lane={lane} session={session} offer={offer} sell={null} />} />)}</CardGrid>
                </>}
            </section>
            <p className="os-note" role="note">
                An open listing or offer holds a storage deposit ({ORDER_DEPOSIT}), and the chain pays it to whoever closes the order: the buyer at a sale, the seller who accepts an offer, the owner who cancels.
                For a week after an order expires only its owner can close it; after that anyone can. Anyone can clear at once a listing whose seller no longer holds the token. An expired offer's escrow always goes back to its buyer.
            </p>
        </>
    )
}
