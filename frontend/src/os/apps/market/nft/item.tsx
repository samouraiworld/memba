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
import { formatAmount, formatBPS } from "../../../../lib/nft/format"
import { getLaneStatus, laneClosedReason } from "../../../../lib/nft/lane"
import { getTokenListing, type NftListing } from "../../../../lib/nft/market"
import { buyBlocker } from "../../../../lib/nft/trade"
import type { OsSession } from "../../../shell/useOsSession"
import { Empty, Loading, Pill, Table } from "../../../kit"
import { ActionButton, OrderForm } from "./actions"
import { quoteOrder, tradeBlocker, useSignAction, useToken } from "./signing"
import { MakeOfferForm, OfferAction } from "./offerActions"
import { CollectionName, OfferCard, OrderList, Price, ReadFailure, TokenArt } from "./orders"
import { isExpired, useCollection, useCollectionOffers, utc, type LaneProps } from "./reads"
import { buyRequest, cancelListingRequest, listRequest } from "./tradeRequest"

interface Payout {
    to: string
    account: string
    amount: bigint
}

/**
 * Buy the listing, or cancel it for its seller. The fee and, for a purchase,
 * the market lane are read at this click, so a paused market is said here
 * rather than in the sheet.
 */
function ListingAction({ lane, session, listing }: { lane: LaneProps; session: OsSession; listing: NftListing }) {
    const action = useSignAction(session)
    const viewer = session.status === "member" ? session.address : ""
    const mine = viewer !== "" && viewer === listing.seller
    // "Not buyable now" is already on the listing; only a reason it does not give is said here.
    if (!mine && !listing.buyable) return null
    const blocker = mine ? "" : buyBlocker(listing, viewer)
    if (blocker) return <p className="os-sub">{blocker}</p>
    const go = () => void action.run(async (caller) => {
        const gas = await networkGasPriceFresh()
        if (!mine) {
            const status = await getLaneStatus("nft_market", listing.currency)
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
        const quote = await quoteOrder(collection, price, "listing")
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
                <OrderList orders={offers} what="offers" empty="No offer applies to this token." keep={(offer) => offer.kind !== "token" || offer.number === number}>
                    {(offer) => <OfferCard key={offer.id} offer={offer} lane={lane} forToken action={<OfferAction lane={lane} session={session} offer={offer} sell={holder && !blocker ? { number, listing: myListing } : null} />} />}
                </OrderList>
            </section>
            <p className="os-note" role="note">
                An open listing holds a storage deposit of about 0.47 GNOT, paid to whoever closes it: the buyer at a sale, the seller who cancels.
                For a week after an order expires only its owner can close it; after that anyone can, and an expired offer's escrow always goes back to its buyer.
            </p>
        </>
    )
}
