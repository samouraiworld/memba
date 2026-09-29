/** One discovery model for registry listings and independently verified editorial links. */
import type { AppListing } from "./appStore"
import type { EcosystemCategory, EcosystemProject } from "./ecosystemDirectory"

export type CatalogueCategory = EcosystemCategory | "Governance" | "Validators" | "Other"
export const CATALOGUE_CATEGORIES: readonly CatalogueCategory[] = [
    "Games", "Exchange", "Governance", "Community", "Wallet", "Explorer",
    "Developer tools", "Validators", "Creative worlds", "Other",
]
export type CatalogueAvailability = "all" | "mainnet" | "testnet" | "tools" | "unknown"
export interface CatalogueFilters {
    q: string
    category: CatalogueCategory | "all"
    availability: CatalogueAvailability
}

export type CatalogueEntry = {
    id: string
    source: "registry" | "editorial"
    name: string
    tagline: string
    category: CatalogueCategory
    url: string
    realmPath: string | null
    availability: CatalogueAvailability
    /** Registry approval is a listing decision, not a source audit. */
    listing?: AppListing
    project?: EcosystemProject
}

const categoryAliases: Record<string, CatalogueCategory> = {
    games: "Games", game: "Games", arcade: "Games",
    exchange: "Exchange", defi: "Exchange", finance: "Exchange", market: "Exchange",
    dao: "Governance", governance: "Governance", treasury: "Governance",
    community: "Community", social: "Community", forum: "Community",
    wallet: "Wallet", explorer: "Explorer", validators: "Validators", validator: "Validators",
    "developer tools": "Developer tools", developer: "Developer tools", infrastructure: "Developer tools",
    "creative worlds": "Creative worlds", creative: "Creative worlds",
}

export function catalogueCategory(raw: string): CatalogueCategory {
    return categoryAliases[raw.trim().toLowerCase()] ?? "Other"
}

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

/** An editorial realm is evidence of the identity; a matching web URL alone is not. */
function matchingProject(listing: Pick<AppListing, "pkgPath">, projects: readonly EcosystemProject[]): EcosystemProject | undefined {
    return projects.find((project) => project.kind !== "tool" && project.realm?.path === normalizeRealmPath(listing.pkgPath))
}

export function buildCatalogue(
    listings: readonly AppListing[],
    projects: readonly EcosystemProject[],
    networkKey = "mainnet",
): CatalogueEntry[] {
    const live = listings.filter((listing) => listing.status === "live")
    const registry: CatalogueEntry[] = live.map((listing) => {
        const project = matchingProject(listing, projects)
        return {
            id: `registry:${listing.pkgPath}`, source: "registry", name: listing.name,
            tagline: listing.tagline || project?.description || "",
            category: catalogueCategory(listing.category), url: listing.appURL,
            realmPath: listing.pkgPath, availability: networkKey === "mainnet" ? "mainnet" : "testnet", listing, project,
        }
    })
    const remaining = notOnChain(projects, live).map((project): CatalogueEntry => ({
        id: `editorial:${project.id}`, source: "editorial", name: project.name,
        tagline: project.description, category: project.category, url: project.url,
        realmPath: project.realm?.path ?? null,
        availability: project.kind === "tool" ? "tools" : project.networks.includes("mainnet") ? "mainnet" : project.networks.includes("staging") ? "testnet" : "unknown",
        project,
    }))
    return [...registry, ...remaining]
}

export function parseCatalogueFilters(params: URLSearchParams): CatalogueFilters {
    const category = params.get("category")
    const availability = params.get("availability")
    return {
        q: (params.get("q") ?? "").slice(0, 200),
        category: CATALOGUE_CATEGORIES.find((value) => value === category) ?? "all",
        availability: (["mainnet", "testnet", "tools", "unknown"] as const).find((value) => value === availability) ?? "all",
    }
}

export function updateCatalogueFilters(params: URLSearchParams, patch: Partial<CatalogueFilters>): URLSearchParams {
    const filters = { ...parseCatalogueFilters(params), ...patch }
    const next = new URLSearchParams(params)
    for (const key of ["q", "category", "availability"] as const) {
        const value = filters[key]
        if (value === "" || value === "all") next.delete(key)
        else next.set(key, key === "q" ? value.slice(0, 200) : value)
    }
    return next
}

export function filterCatalogue(entries: readonly CatalogueEntry[], filters: CatalogueFilters): CatalogueEntry[] {
    const q = filters.q.trim().toLocaleLowerCase()
    return entries.filter((entry) => {
        if (filters.category !== "all" && entry.category !== filters.category) return false
        if (filters.availability === "mainnet" && entry.availability !== "mainnet" && entry.project?.networks.includes("mainnet") !== true) return false
        if (filters.availability === "testnet" && entry.availability !== "testnet" && entry.project?.networks.includes("staging") !== true) return false
        if (filters.availability === "tools" && entry.project?.kind !== "tool") return false
        if (filters.availability === "unknown" && entry.availability !== "unknown") return false
        if (!q) return true
        return [entry.name, entry.tagline, entry.category, entry.realmPath ?? "", entry.project?.status ?? ""]
            .some((value) => value.toLocaleLowerCase().includes(q))
    })
}

export function notOnChain(
    projects: readonly EcosystemProject[],
    listings: readonly Pick<AppListing, "pkgPath" | "appURL">[],
): EcosystemProject[] {
    const paths = new Set(listings.map((listing) => normalizeRealmPath(listing.pkgPath)))
    return projects.filter((project) => {
        if (project.kind === "tool") return true
        if (project.realm && paths.has(normalizeRealmPath(project.realm.path))) return false
        // A third-party listing can copy an external project's URL. That is not
        // proof it owns the project, so only a verified realm path may collapse it.
        return true
    })
}
