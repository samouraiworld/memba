/**
 * Curated collections to pin to the front of the NFT lane, in order. Entries are
 * FULL address-qualified ids (`g1…creator/slug`) — the same value as HubCollection.id.
 *
 * SECURITY: matching is on the full caller/slug id ONLY, never on a bare slug or the
 * display name. A slug-only match would be an impersonation vector — any creator can
 * CreateCollection("genesis") from their own address, so a bare-slug pin would promote
 * an imposter. Keep this list to verified full ids you have confirmed on-chain.
 *
 * Empty for now: nothing is pinned until a collection is curated, so this is a no-op
 * in production (orderByFeatured returns the input untouched on an empty list).
 */
export const FEATURED_COLLECTION_IDS: readonly string[] = []

/**
 * Stable curated-first ordering: items whose FULL id is in `featuredIds` float to the
 * front in `featuredIds` order; everything else keeps its incoming order (Array.sort is
 * stable). Returns the input array unchanged when nothing is curated. Full-id match only.
 */
export function orderByFeatured<T extends { id: string }>(list: T[], featuredIds: readonly string[]): T[] {
    if (featuredIds.length === 0) return list
    const rank = (c: T): number => {
        const i = featuredIds.indexOf(c.id)
        return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    return [...list].sort((a, b) => rank(a) - rank(b))
}
