/**
 * What the NFT window's screens share: the network they read, how they move
 * between sections, the query for a token's metadata file, a curation hide,
 * and how a time and a retired token are written.
 *
 * @module os/apps/nft/screen
 */
import { queryOptions, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { isRealmValidOn } from "../../../lib/config"
import { NFT_CURATION_PATH, getCurationRecord } from "../../../lib/nft/curation"
import type { NftTokenStatus } from "../../../lib/nft/ledger"
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

/** Unix seconds as a fixed UTC time, the same for every reader: "2026-10-01 14:00 UTC". */
export function when(seconds: bigint): string {
    return `${new Date(Number(seconds) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`
}

export const RETIRED: Record<Exclude<NftTokenStatus, "active">, string> = { burned: "Burned", revoked: "Revoked" }

/**
 * Whether a collection's creator-supplied art and text may be shown. Curation
 * blocks nothing: a collection curators hide stays browsable, and only what
 * its creator chose to show stays collapsed until the viewer asks for it. While
 * the record is unknown (being read, or unreadable) it stays collapsed too;
 * where the curation realm is not available there is no record to wait for.
 */
export function useCurationHide(screen: NftScreen, collection: string) {
    const curated = isRealmValidOn(screen.network, NFT_CURATION_PATH)
    const [revealed, setRevealed] = useState(false)
    const record = useQuery({
        queryKey: ["nft", "curation", "record", screen.chainId, collection],
        queryFn: () => getCurationRecord(collection),
        enabled: curated,
        staleTime: 60_000, retry: false,
    })
    return { curated, record, revealed, reveal: () => setRevealed(true), shown: !curated || revealed || record.data?.hidden === false }
}

export type CurationHide = ReturnType<typeof useCurationHide>
