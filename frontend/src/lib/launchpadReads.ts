/**
 * launchpadReads.ts — on-chain reads for the memba_collections registry.
 *
 * Thin async glue over `queryRender` + the pure parsers in launchpad.ts, kept
 * separate so the builder/parser module stays network-free and easily testable.
 *
 * @module lib/launchpadReads
 */

import { GNO_RPC_URL } from "./config"
import { NFT_COLLECTIONS_PATH } from "./nftConfig"
import { queryRender } from "./dao/shared"
import {
    parseCollectionList,
    parseCollectionDetail,
    type CollectionListRow,
    type CollectionDetail,
} from "./launchpad"

/** Fetch the full collection list from Render(""). Returns [] on null/empty. */
export async function fetchCollectionList(
    rpcUrl: string = GNO_RPC_URL,
    collectionsPath: string = NFT_COLLECTIONS_PATH,
): Promise<CollectionListRow[]> {
    const md = await queryRender(rpcUrl, collectionsPath, "")
    return md ? parseCollectionList(md) : []
}

/** Fetch one collection's detail via Render("collection/<id>"). null if absent. */
export async function fetchCollectionDetail(
    id: string,
    rpcUrl: string = GNO_RPC_URL,
    collectionsPath: string = NFT_COLLECTIONS_PATH,
): Promise<CollectionDetail | null> {
    const md = await queryRender(rpcUrl, collectionsPath, `collection/${id}`)
    return md ? parseCollectionDetail(md) : null
}

/** Collections launched by a given creator address (powers creator profiles). */
export async function fetchCollectionsByCreator(
    creator: string,
    rpcUrl: string = GNO_RPC_URL,
    collectionsPath: string = NFT_COLLECTIONS_PATH,
): Promise<CollectionListRow[]> {
    const all = await fetchCollectionList(rpcUrl, collectionsPath)
    return all.filter((c) => c.creator === creator)
}
