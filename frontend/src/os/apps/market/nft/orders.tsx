/**
 * How the Market NFT lane shows open orders: a cursor-paged list, a listing,
 * an offer, a price, a token's art. A failed read is an error, never an empty
 * market, with a retry only where one can help. Names and traits are written by creators and buyers,
 * so they reach the page through `revealInvisibleFormatting`.
 *
 * @module os/apps/market/nft/orders
 */
import { useQuery, type InfiniteData, type UseInfiniteQueryResult } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { useNow } from "../../../../hooks/home/useNow"
import { revealInvisibleFormatting } from "../../../../lib/dao/v2Text"
import { formatAmount, formatBPS } from "../../../../lib/nft/format"
import { getToken } from "../../../../lib/nft/ledger"
import type { NftListing, NftOffer, NftOfferKind } from "../../../../lib/nft/market"
import { fetchTokenMetadata } from "../../../../lib/nft/metadata"
import { ReadError, RealmRefusedError } from "../../../../lib/nft/read"
import { Card, CardGrid, Empty, ErrorState, Loading, Pill, Table } from "../../../kit"
import { TokenMedia } from "../../../nft/TokenMedia"
import { ORDER_DEPOSIT, isExpired, useCollection, utc, type LaneProps } from "./reads"

/**
 * A read that failed, as the NFT app shows one: a read that reached no answer
 * may succeed again, so it has a retry; a query the realm refused (what it
 * names does not exist) or an answer that breaks its rules fails the same way
 * every time, so it has none.
 */
export function ReadFailure({ error, what, refused, unread, retry }: { error: Error; what: string; refused?: string; unread?: string; retry: () => void }) {
    if (error instanceof ReadError) return <ErrorState message={unread ?? `The ${what} could not be read from this network.`} onRetry={retry} />
    if (error instanceof RealmRefusedError) return <ErrorState message={refused ?? `This network's realm refused to read the ${what}.`} />
    return <ErrorState message={`What this network sent for the ${what} does not follow the realm's rules, so it is not shown.`} />
}

/**
 * One list of open orders. `keep` narrows what is shown, so the list is empty
 * only once nothing more can be read; Load more stays while the last page was full.
 */
export function OrderList<T>({ orders, what, empty, keep = () => true, children }: {
    orders: UseInfiniteQueryResult<InfiniteData<T[], unknown>>
    what: string
    empty: string
    keep?: (order: T) => boolean
    children: (order: T) => ReactNode
}) {
    if (orders.isPending) return <Loading label={`Reading ${what}…`} />
    if (orders.isError && !orders.isFetchNextPageError) return <ReadFailure error={orders.error} what={what} retry={() => void orders.refetch()} />
    const shown = (orders.data?.pages ?? []).flat().filter(keep)
    return (
        <div className="os-stack os-tight">
            {shown.length > 0 ? <CardGrid>{shown.map(children)}</CardGrid>
                : orders.hasNextPage ? <p className="os-sub">None among the {what} read so far.</p>
                : <Empty title={empty} />}
            {orders.isFetchNextPageError ? <ReadFailure error={orders.error} what={`next ${what}`} unread={`More ${what} could not be read.`} retry={() => void orders.fetchNextPage()} />
                : orders.hasNextPage && (
                    <button type="button" className="os-btn" onClick={() => void orders.fetchNextPage()} disabled={orders.isFetchingNextPage}>
                        {orders.isFetchingNextPage ? `Reading more ${what}…` : `Load more ${what}`}
                    </button>
                )}
        </div>
    )
}

/** The price as the realm states it; a GRC20 is also named by its full registry key, since two can share a last segment. */
export function Price({ order }: { order: NftListing | NftOffer }) {
    return (
        <span>
            <b>{formatAmount(order.price, order.currency)}</b>
            {order.currency !== "ugnot" && <span className="os-sub os-block os-mono">{order.currency}</span>}
        </span>
    )
}

/** Who closing an order pays its deposit to, in one line under its price. */
export function DepositRule({ order }: { order: "listing" | "offer" }) {
    return <span className="os-sub">{order === "listing"
        ? `Holds a deposit (${ORDER_DEPOSIT}) paid to whoever closes it: the buyer, or the seller who cancels.`
        : `Holds a deposit (${ORDER_DEPOSIT}) paid to whoever closes it: the seller who accepts, or the buyer who cancels.`}</span>
}

interface Payout {
    to: string
    account: string
    amount: bigint
}

/** How the price is paid out, as the realm computed it. `seller` is the account paid the rest; empty for an offer, whose seller is whoever accepts. */
export function Payouts({ order, seller }: { order: NftListing | NftOffer; seller: string }) {
    const rows: Payout[] = [
        { to: "Seller", account: seller, amount: order.split.seller },
        { to: `Protocol fee (${formatBPS(order.feeBPS)})`, account: "", amount: order.split.fee },
        ...order.split.royalties.map((royalty) => ({ to: "Royalty", account: royalty.account, amount: royalty.amount })),
    ]
    return (
        <div className="os-stack os-tight">
            {order.currency !== "ugnot" && <span className="os-sub">Amounts in <span className="os-mono">{order.currency}</span>, a registry token, not GNOT.</span>}
            <Table<Payout>
                columns={[
                    { key: "to", label: "Paid to", render: (row) => row.to },
                    { key: "account", label: "Account", render: (row) => <span className="os-mono" style={{ overflowWrap: "anywhere" }}>{row.account || (row.to === "Seller" ? "The holder who accepts" : "Treasury")}</span> },
                    { key: "amount", label: "Amount", align: "end", render: (row) => formatAmount(row.amount, order.currency) },
                ]}
                rows={rows}
                rowKey={(row) => `${row.to}:${row.account}`}
                empty={null}
            />
        </div>
    )
}

export function CollectionName({ chainId, id }: { chainId: string; id: string }) {
    const collection = useCollection(chainId, id)
    return <>{collection.data ? revealInvisibleFormatting(collection.data.name) || id : id}</>
}

/** The token's image from its metadata file; until that is read, or when it cannot be, the art generated for the token. */
export function TokenArt({ chainId, collection, number, alt }: { chainId: string; collection: string; number: bigint; alt: string }) {
    const token = useQuery({
        queryKey: ["nft", "ledger", "token", chainId, collection, number.toString()],
        queryFn: () => getToken(collection, number),
        staleTime: 60_000, retry: false,
    })
    const uri = token.data?.uri ?? ""
    const metadata = useQuery({
        queryKey: ["nft", "metadata", chainId, uri],
        queryFn: ({ signal }) => fetchTokenMetadata(uri, signal),
        enabled: uri !== "", staleTime: Infinity, retry: false,
    })
    return <TokenMedia uri={metadata.data?.image ?? null} seed={`${collection}/${number}`} alt={alt} />
}

/** A listing as a card that opens its token's trade panel. `mine`: the viewer is its seller. */
export function ListingCard({ listing, lane, mine = false }: { listing: NftListing; lane: LaneProps; mine?: boolean }) {
    const now = useNow(60_000)
    const expired = isExpired(listing, now)
    return (
        <Card onClick={() => lane.go({ kind: "token", collection: listing.collection, number: listing.number })}>
            <span className="os-grow os-stack os-tight" style={{ overflowWrap: "anywhere" }}>
                <TokenArt chainId={lane.chainId} collection={listing.collection} number={listing.number} alt="" />
                <span><CollectionName chainId={lane.chainId} id={listing.collection} /> #{listing.number.toString()}</span>
                <Price order={listing} />
                <DepositRule order="listing" />
                <span className="os-sub">{expired ? "Expired" : "Expires"} {utc(listing.expiresAt)}</span>
                {mine && expired ? <Pill tone="warn">Expired: yours to close</Pill> : (!listing.buyable || expired) && <Pill tone="warn">Not buyable now</Pill>}
            </span>
        </Card>
    )
}

const KIND: Record<NftOfferKind, string> = { token: "Token offer", collection: "Collection offer", trait: "Trait offer" }

/**
 * An offer, labelled by what it is for. `forToken`: shown on one token's panel,
 * where a trait offer applies only if that token carries the trait. A card
 * opens the token or collection the offer is for, unless it is already shown.
 * `action` (cancel, accept) sits below the card, never inside a card that is a button.
 */
export function OfferCard({ offer, lane, mine = false, forToken = false, action }: { offer: NftOffer; lane: LaneProps; mine?: boolean; forToken?: boolean; action?: ReactNode }) {
    const now = useNow(60_000)
    const expired = isExpired(offer, now)
    const trait = revealInvisibleFormatting(offer.trait)
    const target = offer.kind === "token" ? `#${offer.number}`
        : offer.kind === "collection" ? "Any token of the collection"
        : forToken ? `If this token carries ${trait}` : `Tokens carrying ${trait}`
    const body = (
        <span className="os-grow os-stack os-tight" style={{ overflowWrap: "anywhere" }}>
            <span><Pill tone="neutral">{KIND[offer.kind]}</Pill> {!forToken && <CollectionName chainId={lane.chainId} id={offer.collection} />}</span>
            <span>{target}</span>
            <Price order={offer} />
            <DepositRule order="offer" />
            <span className="os-sub">{expired ? "Expired" : "Expires"} {utc(offer.expiresAt)}</span>
            {expired && <Pill tone="warn">{mine ? "Expired: yours to close" : "Expired: waiting for its refund"}</Pill>}
            {forToken && !expired && <Payouts order={offer} seller="" />}
        </span>
    )
    const card = forToken ? <Card>{body}</Card>
        : <Card onClick={() => lane.go(offer.kind === "token" ? { kind: "token", collection: offer.collection, number: offer.number } : { kind: "collection", collection: offer.collection })}>{body}</Card>
    return action ? <div className="os-stack os-tight">{card}{action}</div> : card
}
