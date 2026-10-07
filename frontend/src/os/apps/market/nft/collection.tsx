/**
 * Market NFT lane, one collection (`nfts/c/<id>`): its open listings in token
 * order and its open offers of every kind, oldest first, with a link to the
 * collection's profile in the NFT app. A member makes a collection offer here
 * and cancels its own; a holder accepts one from its token's panel.
 *
 * @module os/apps/market/nft/collection
 */
import { listCollectionListings } from "../../../../lib/nft/market"
import type { OsSession } from "../../../shell/useOsSession"
import { tradeBlocker, useTradingClosed } from "./signing"
import { MakeOfferForm, OfferAction } from "./offerActions"
import { CollectionName, ListingCard, OfferCard, OrderList, ReadFailure } from "./orders"
import { PAGE_SIZE, useCollection, useCollectionOffers, useOrders, type LaneProps } from "./reads"

export function CollectionTrade({ lane, session, collection }: { lane: LaneProps; session: OsSession; collection: string }) {
    const profile = useCollection(lane.chainId, collection)
    const listings = useOrders([lane.chainId, "collection-listings", collection],
        (after: bigint) => listCollectionListings(collection, after, PAGE_SIZE), 0n, (last) => last.number)
    const offers = useCollectionOffers(lane.chainId, collection)
    const closed = useTradingClosed(session.network.key)
    return (
        <>
            <div className="os-row">
                <h3 className="os-h os-flush os-grow" style={{ overflowWrap: "anywhere" }}><CollectionName chainId={lane.chainId} id={collection} /></h3>
                <button type="button" className="os-btn os-quiet" onClick={() => lane.go({ kind: "application", collection })}>Curation</button>
                <button type="button" className="os-btn os-quiet" onClick={() => lane.openNft({ kind: "collection", collection })}>Collection profile</button>
            </div>
            {profile.isError && <ReadFailure error={profile.error} what="collection" refused={`There is no collection ${collection} on this network.`} retry={() => void profile.refetch()} />}
            <section aria-label="Listings in this collection">
                <h4 className="os-h">Listings</h4>
                <OrderList orders={listings} what="listings" empty="No token of this collection is listed.">
                    {(listing) => <ListingCard key={listing.id} listing={listing} lane={lane} />}
                </OrderList>
            </section>
            {profile.data && !closed && (
                <section aria-label="Make a collection offer">
                    <h4 className="os-h">Make a collection offer</h4>
                    {tradeBlocker(profile.data) ? <p className="os-sub">{tradeBlocker(profile.data)}</p>
                        : <><p className="os-sub">Any holder of a token of this collection may accept it.</p><MakeOfferForm lane={lane} session={session} kind="collection" collection={collection} number={0n} /></>}
                </section>
            )}
            <section aria-label="Offers on this collection">
                <h4 className="os-h">Offers</h4>
                <OrderList orders={offers} what="offers" empty="No offer is open on this collection.">
                    {(offer) => <OfferCard key={offer.id} offer={offer} lane={lane} action={<OfferAction lane={lane} session={session} offer={offer} sell={null} />} />}
                </OrderList>
            </section>
        </>
    )
}
