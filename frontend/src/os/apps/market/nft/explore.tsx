/**
 * Market NFT lane, Explore (`nfts`): every open listing and every open offer,
 * newest first. The realm keeps open orders only, so whatever is read is open;
 * a listing that cannot be bought right now says so.
 *
 * @module os/apps/market/nft/explore
 */
import { listListings, listOffers } from "../../../../lib/nft/market"
import { ListingCard, OfferCard, OrderList } from "./orders"
import { PAGE_SIZE, useOrders, type LaneProps } from "./reads"

export function Explore({ lane }: { lane: LaneProps }) {
    const listings = useOrders([lane.chainId, "listings"], (before: string) => listListings(before, PAGE_SIZE), "", (last) => last.id)
    const offers = useOrders([lane.chainId, "offers"], (before: string) => listOffers(before, PAGE_SIZE), "", (last) => last.id)
    return (
        <>
            <section aria-label="Open listings">
                <h3 className="os-h">Open listings</h3>
                <OrderList orders={listings} what="listings" empty="No token is listed right now.">
                    {(listing) => <ListingCard key={listing.id} listing={listing} lane={lane} />}
                </OrderList>
            </section>
            <section aria-label="Open offers">
                <h3 className="os-h">Open offers</h3>
                <OrderList orders={offers} what="offers" empty="No offer is open right now.">
                    {(offer) => <OfferCard key={offer.id} offer={offer} lane={lane} />}
                </OrderList>
            </section>
        </>
    )
}
