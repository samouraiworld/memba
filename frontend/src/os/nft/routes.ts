/**
 * The window sections of the NFT app and of Market's NFT lane, as the OS
 * passes them to a native view (`null` is the app's home), and back. A section
 * is part of an address anyone can type, so it is read as strictly as a realm
 * answer: one spelling per route, and whatever is not exactly that is not a
 * route, which leaves it to the view's fallback. Every route that parses builds
 * back into the section it came from.
 *
 * @module os/nft/routes
 */
import { collectionId, tokenNumber } from "../../lib/nft/parse"

type CollectionRoute =
    | { kind: "collection"; collection: string }
    | { kind: "token"; collection: string; number: bigint }

/** NFT app: `null`, `c/<id>`, `c/<id>/<number>`, `mine`, `create`, `studio`, `studio/<id>`. */
export type NftRoute =
    | { kind: "home" }
    | CollectionRoute
    | { kind: "mine" }
    | { kind: "create" }
    | { kind: "studio" }
    | { kind: "studio-collection"; collection: string }

/** Market app, NFT lane: `nfts`, `nfts/c/<id>`, `nfts/c/<id>/<number>`, `nfts/mine`. */
export type MarketNftRoute =
    | { kind: "explore" }
    | CollectionRoute
    | { kind: "mine" }

/** The strict readers throw on a value that does not fit, and on nothing else: here that is a section nobody serves. */
function read<T>(parse: () => T): T | null {
    try {
        return parse()
    } catch {
        return null
    }
}

/** `c/<id>` or `c/<id>/<number>`, the same in both apps. */
function parseCollectionPath(path: string): CollectionRoute | null {
    const [prefix, id, number, ...extra] = path.split("/")
    if (prefix !== "c" || extra.length > 0) return null
    return read<CollectionRoute>(() => number === undefined
        ? { kind: "collection", collection: collectionId(id) }
        : { kind: "token", collection: collectionId(id), number: tokenNumber(number) })
}

/** Throws on a route that could not have been parsed: a malformed ID or number never becomes an address. */
function collectionPath(route: CollectionRoute): string {
    const path = `c/${collectionId(route.collection)}`
    return route.kind === "collection" ? path : `${path}/${tokenNumber(route.number.toString())}`
}

/** The route an NFT window section names, or null when it is not one of these sections. */
export function parseNftSection(section: string | null): NftRoute | null {
    if (section === null) return { kind: "home" }
    if (section === "mine" || section === "create" || section === "studio") return { kind: section }
    if (section.startsWith("studio/")) return read<NftRoute>(() => ({ kind: "studio-collection", collection: collectionId(section.slice(7)) }))
    return parseCollectionPath(section)
}

export function nftSection(route: NftRoute): string | null {
    if (route.kind === "home") return null
    if (route.kind === "mine" || route.kind === "create" || route.kind === "studio") return route.kind
    return route.kind === "studio-collection" ? `studio/${collectionId(route.collection)}` : collectionPath(route)
}

/** The NFT-lane route a Market window section names, or null when it is not one of these sections. */
export function parseMarketNftSection(section: string | null): MarketNftRoute | null {
    if (section === "nfts") return { kind: "explore" }
    if (section === "nfts/mine") return { kind: "mine" }
    return section?.startsWith("nfts/") ? parseCollectionPath(section.slice(5)) : null
}

export function marketNftSection(route: MarketNftRoute): string {
    if (route.kind === "explore") return "nfts"
    return route.kind === "mine" ? "nfts/mine" : `nfts/${collectionPath(route)}`
}
