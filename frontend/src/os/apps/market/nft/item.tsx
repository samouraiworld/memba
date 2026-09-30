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
import { formatAmount, formatBPS } from "../../../../lib/nft/format"
import { getTokenListing, type NftListing } from "../../../../lib/nft/market"
import { Empty, Loading, Pill, Table } from "../../../kit"
import { CollectionName, OfferCard, OrderList, Price, ReadFailure, TokenArt } from "./orders"
import { isExpired, useCollectionOffers, utc, type LaneProps } from "./reads"

interface Payout {
    to: string
    account: string
    amount: bigint
}

function Listing({ listing }: { listing: NftListing }) {
    const now = useNow(60_000)
    const payouts: Payout[] = [
        { to: "Seller", account: listing.seller, amount: listing.split.seller },
        { to: `Protocol fee (${formatBPS(listing.feeBPS)})`, account: "", amount: listing.split.fee },
        ...listing.split.royalties.map((royalty) => ({ to: "Royalty", account: royalty.account, amount: royalty.amount })),
    ]
    return (
        <div className="os-stack os-tight">
            <div className="os-row">
                <Price order={listing} />
                {listing.buyable ? <Pill tone="ok">Buyable now</Pill> : <Pill tone="warn">Not buyable now</Pill>}
            </div>
            <span className="os-sub">Listed {utc(listing.createdAt)} · {isExpired(listing, now) ? "expired" : "expires"} {utc(listing.expiresAt)}</span>
            <Table<Payout>
                columns={[
                    { key: "to", label: "Paid to", render: (row) => row.to },
                    { key: "account", label: "Account", render: (row) => <span className="os-mono" style={{ overflowWrap: "anywhere" }}>{row.account || "Treasury"}</span> },
                    { key: "amount", label: "Amount", align: "end", render: (row) => formatAmount(row.amount, listing.currency) },
                ]}
                rows={payouts}
                rowKey={(row) => `${row.to}:${row.account}`}
                empty={null}
            />
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
                <OrderList orders={offers} what="offers" empty="No offer applies to this token." keep={(offer) => offer.kind !== "token" || offer.number === number}>
                    {(offer) => <OfferCard key={offer.id} offer={offer} lane={lane} forToken />}
                </OrderList>
            </section>
            <p className="os-note" role="note">
                An open listing holds a storage deposit of about 0.47 GNOT, paid to whoever closes it: the buyer at a sale, the seller who cancels.
                For a week after an order expires only its owner can close it; after that anyone can, and an expired offer's escrow always goes back to its buyer.
            </p>
        </>
    )
}
