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
import { queryRender, queryEval } from "./dao/shared"
import {
    parseCollectionList,
    parseCollectionDetail,
    META_VERIFIED_KEY,
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

/** Read a per-collection meta value via qeval GetCollectionMeta(id,key). "" if unset. */
export async function fetchCollectionMeta(
    id: string,
    key: string,
    rpcUrl: string = GNO_RPC_URL,
    collectionsPath: string = NFT_COLLECTIONS_PATH,
): Promise<string> {
    const res = await queryEval(rpcUrl, collectionsPath, `GetCollectionMeta(${JSON.stringify(id)}, ${JSON.stringify(key)})`)
    if (!res) return ""
    const m = res.match(/"([^"]*)"/)
    return m ? m[1] : ""
}

/** Whether a collection carries the team/DAO-curated verified badge. */
export async function isCollectionVerified(
    id: string,
    rpcUrl: string = GNO_RPC_URL,
    collectionsPath: string = NFT_COLLECTIONS_PATH,
): Promise<boolean> {
    return (await fetchCollectionMeta(id, META_VERIFIED_KEY, rpcUrl, collectionsPath)) === "true"
}
