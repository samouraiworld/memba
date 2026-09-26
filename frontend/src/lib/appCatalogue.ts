/** Keep one Store card per app while retaining projects without a registry listing. */
import type { AppListing } from "./appStore"
import type { EcosystemProject } from "./ecosystemDirectory"

export function normalizeAppUrl(value: string): string | null {
    try {
        const url = new URL(value)
        if (url.protocol !== "http:" && url.protocol !== "https:") return null
        return `${url.hostname.replace(/^www\./, "")}${url.port ? `:${url.port}` : ""}${url.pathname.replace(/\/+$/, "")}`.toLowerCase()
    } catch {
        return null
    }
}

function normalizeRealmPath(value: string): string {
    return value.trim().replace(/\/+$/, "")
}

export function notOnChain(
    projects: readonly EcosystemProject[],
    listings: readonly Pick<AppListing, "pkgPath" | "appURL">[],
): EcosystemProject[] {
    const paths = new Set(listings.map((listing) => normalizeRealmPath(listing.pkgPath)))
    const urls = new Set(listings.map((listing) => normalizeAppUrl(listing.appURL)).filter((url): url is string => url !== null))
    return projects.filter((project) => {
        if (project.kind === "tool") return true
        if (project.realm && paths.has(normalizeRealmPath(project.realm.path))) return false
        const url = normalizeAppUrl(project.url)
        return url === null || !urls.has(url)
    })
}
