/**
 * What the Market NFT lane's views read, and how: open orders by cursor and
 * ledger records, each keyed by the session's chain, and how an order's time
 * is written.
 *
 * @module os/apps/market/nft/reads
 */
import { useInfiniteQuery, useQuery, type InfiniteData } from "@tanstack/react-query"
import { getCollection } from "../../../../lib/nft/ledger"
import { listCollectionOffers } from "../../../../lib/nft/market"
import type { MarketNftRoute, NftRoute } from "../../../nft/routes"

export const PAGE_SIZE = 20

/** What every view of the lane is given: the chain it reads, and where its links go. */
export interface LaneProps {
    chainId: string
    /** Another view of this lane, as a link: a history entry of its own. */
    go: (route: MarketNftRoute) => void
    /** A view of the NFT app, in its own window. */
    openNft: (route: NftRoute) => void
}

/** Open orders by cursor: a full page may have more behind it, read from past its last order. */
export function useOrders<T, C>(key: readonly string[], read: (cursor: C) => Promise<T[]>, first: C, next: (last: T) => C) {
    return useInfiniteQuery<T[], Error, InfiniteData<T[], C>, readonly string[], C>({
        queryKey: ["nft", "market", ...key],
        // The page parameter is `first` or what `next` returned; the context's conditional type cannot say so for a generic cursor.
        queryFn: ({ pageParam }) => read(pageParam as C),
        initialPageParam: first,
        getNextPageParam: (page: T[]) => page.length === PAGE_SIZE ? next(page[page.length - 1]) : undefined,
        staleTime: 30_000, retry: false,
    })
}

export function useCollection(chainId: string, id: string) {
    return useQuery({
        queryKey: ["nft", "ledger", "collection", chainId, id],
        queryFn: () => getCollection(id),
        staleTime: 60_000, retry: false,
    })
}

/** A collection's open offers: the collection view shows them all, a token's panel the ones that apply to it. */
export function useCollectionOffers(chainId: string, collection: string) {
    return useOrders([chainId, "collection-offers", collection], (after: string) => listCollectionOffers(collection, after, PAGE_SIZE), "", (last) => last.id)
}

/** Unix seconds as a UTC date and time, the same for every viewer. */
export function utc(seconds: bigint): string {
    const date = new Date(Number(seconds) * 1000)
    return Number.isNaN(date.getTime()) ? `${seconds} (Unix time)` : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`
}

export const isExpired = (order: { expiresAt: bigint }, now: number) => order.expiresAt * 1000n <= BigInt(now)

/**
 * The storage deposit an open order holds, measured on a committed node at the
 * mainnet Gno pin: 7,751 bytes for a listing, 7,813 for an offer, at 100 ugnot
 * a byte. The chain pays it to whoever's call closes the order.
 */
export const ORDER_DEPOSIT = "about 0.78 GNOT"
