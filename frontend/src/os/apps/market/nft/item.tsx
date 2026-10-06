/**
 * Market NFT lane, one token's trade panel (`nfts/c/<id>/<number>`): its open
 * listing with the split the realm computed for it, the offers that can apply
 * to it, and the rule for who closes an order, with a link to the token's
 * page in the NFT app. Read-only: nothing here signs.
 *
 * @module os/apps/market/nft/item
 */
import { useQuery } from "@tanstack/react-query"
import { useNow } from "../../../../hooks/home/useNow"
import { getTokenListing, type NftListing, type NftOffer } from "../../../../lib/nft/market"
import { CardGrid, Empty, Loading, Pill } from "../../../kit"
import { CollectionName, DepositRule, OfferCard, OrderList, Payouts, Price, ReadFailure, TokenArt } from "./orders"
import { ORDER_DEPOSIT, isExpired, useCollectionOffers, utc, type LaneProps } from "./reads"

function Listing({ listing }: { listing: NftListing }) {
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
        </div>
    )
}

export function ItemTrade({ lane, collection, number }: { lane: LaneProps; collection: string; number: bigint }) {
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
                    : <Listing listing={listing.data} />}
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
