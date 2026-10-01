/**
 * Market NFT lane, My trading (`nfts/mine`): the connected account's open
 * listings and offers, oldest first. An expired order stays open until it is
 * closed, and for a week only its owner may close it. The one view of the
 * lane that needs a wallet: a guest is asked to connect here and nowhere else.
 *
 * @module os/apps/market/nft/mine
 */
import { listBuyerOffers, listSellerListings } from "../../../../lib/nft/market"
import type { OsSession } from "../../../shell/useOsSession"
import { OfferAction } from "./offerActions"
import { ListingCard, OfferCard, OrderList } from "./orders"
import { PAGE_SIZE, useOrders, type LaneProps } from "./reads"

function Trading({ lane, session, address }: { lane: LaneProps; session: OsSession; address: string }) {
    const listings = useOrders([lane.chainId, "seller-listings", address], (after: string) => listSellerListings(address, after, PAGE_SIZE), "", (last) => last.id)
    const offers = useOrders([lane.chainId, "buyer-offers", address], (after: string) => listBuyerOffers(address, after, PAGE_SIZE), "", (last) => last.id)
    return (
        <>
            <section aria-label="My listings">
                <h3 className="os-h">My listings</h3>
                <OrderList orders={listings} what="listings" empty="You have no open listing.">
                    {(listing) => <ListingCard key={listing.id} listing={listing} lane={lane} mine />}
                </OrderList>
            </section>
            <section aria-label="My offers">
                <h3 className="os-h">My offers</h3>
                <OrderList orders={offers} what="offers" empty="You have no open offer.">
                    {(offer) => <OfferCard key={offer.id} offer={offer} lane={lane} mine action={<OfferAction lane={lane} session={session} offer={offer} sell={null} />} />}
                </OrderList>
            </section>
        </>
    )
}

export function MyTrading({ lane, session }: { lane: LaneProps; session: OsSession }) {
    const address = session.status === "member" ? session.address : ""
    if (address !== "") return <Trading lane={lane} session={session} address={address} />
    return (
        <div className="os-note os-row" role="note">
            <span className="os-grow">Connect a wallet to see your open listings and offers.</span>
            <button type="button" className="os-btn" onClick={session.openConnect}>Connect wallet</button>
        </div>
    )
}
