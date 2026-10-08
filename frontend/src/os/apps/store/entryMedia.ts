import type { CatalogueEntry } from "../../../lib/appCatalogue"
import { projectReviewSubject } from "../../../lib/reviewSubjects"
import { mediaKeyFor, resolveMedia, type ResolvedMedia } from "../../../lib/storeMedia"

export function entryMedia(entry: CatalogueEntry): ResolvedMedia {
    return resolveMedia(mediaKeyFor(entry.project?.id, entry.realmPath), entry.listing, entry.id)
}

/** The permanent review subject: the project's pinned subject, else the listing's realm. */
export function entrySubject(entry: CatalogueEntry): string {
    return entry.project ? projectReviewSubject(entry.project) : entry.realmPath!
}
