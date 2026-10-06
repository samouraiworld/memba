/**
 * What the NFT window's screens share: the network they read, how they move
 * between sections, the queries for a collection and a token's metadata file,
 * a curation hide, and how a retired token is written.
 *
 * @module os/apps/nft/screen
 */
import { queryOptions, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { isRealmValidOn } from "../../../lib/config"
import { NFT_CURATION_PATH, getCurationRecord } from "../../../lib/nft/curation"
import { getCollection, type NftTokenStatus } from "../../../lib/nft/ledger"
import { fetchTokenMetadata } from "../../../lib/nft/metadata"
import type { MarketNftRoute, NftRoute } from "../../nft/routes"

export const PAGE_SIZE = 20

/** Where a screen reads and how it goes elsewhere: `go` within this window, `trade` to Market's NFT lane. */
export interface NftScreen {
    chainId: string
    network: string
    go: (route: NftRoute) => void
    trade: (route: MarketNftRoute) => void
}

/** A collection's full record: one read shared by its profile and its item pages. */
export function collectionQuery(chainId: string, id: string) {
    return queryOptions({
        queryKey: ["nft", "ledger", "collection", chainId, id],
        queryFn: () => getCollection(id),
        staleTime: 60_000, retry: false,
    })
}

/** A token's metadata file: content-addressed, so one read serves every screen that shows the token. */
export function metadataQuery(chainId: string, uri: string) {
    return queryOptions({
        queryKey: ["nft", "metadata", chainId, uri],
        queryFn: ({ signal }) => fetchTokenMetadata(uri, signal),
        enabled: uri !== "",
        staleTime: Infinity,
        retry: false,
    })
}

export const RETIRED: Record<Exclude<NftTokenStatus, "active">, string> = { burned: "Burned", revoked: "Revoked" }

/**
 * A collection's curation record, read once however many screens and cards
 * show the collection. `cleared` is true only once the record is read and does
 * not hide the collection, or where the curation realm is not available and
 * there is no record to wait for.
 */
export function useCurationRecord(screen: NftScreen, collection: string) {
    const curated = isRealmValidOn(screen.network, NFT_CURATION_PATH)
    const record = useQuery({
        queryKey: ["nft", "curation", "record", screen.chainId, collection],
        queryFn: () => getCurationRecord(collection),
        enabled: curated,
        staleTime: 60_000, retry: false,
    })
    return { curated, record, cleared: !curated || record.data?.hidden === false }
}

/**
 * Whether a collection's creator-supplied art and text may be shown. Curation
 * blocks nothing: a collection curators hide stays browsable, and only what
 * its creator chose to show stays collapsed until the viewer asks for it. While
 * the record is unknown (being read, or unreadable) it stays collapsed too.
 */
export function useCurationHide(screen: NftScreen, collection: string) {
    const { curated, record, cleared } = useCurationRecord(screen, collection)
    const [revealed, setRevealed] = useState(false)
    return { curated, record, revealed, reveal: () => setRevealed(true), shown: revealed || cleared }
}

export type CurationHide = ReturnType<typeof useCurationHide>
