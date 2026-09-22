import { ECOSYSTEM_AVAILABILITY, ECOSYSTEM_CATEGORIES, type EcosystemFilters } from "./ecosystemDirectory"

export function parseEcosystemFilters(params: URLSearchParams): EcosystemFilters {
    const category = params.get("category")
    const availability = params.get("availability")
    return {
        q: (params.get("q") ?? "").slice(0, 200),
        category: ECOSYSTEM_CATEGORIES.find(value => value === category) ?? "all",
        availability: ECOSYSTEM_AVAILABILITY.find(value => value === availability) ?? "all",
    }
}
/** Preserve unrelated query parameters on the shared App Store route. */
export function updateEcosystemFilters(params: URLSearchParams, patch: Partial<EcosystemFilters>): URLSearchParams {
    const state = { ...parseEcosystemFilters(params), ...patch }
    const next = new URLSearchParams(params)
    for (const key of ["q", "category", "availability"] as const) {
        const value = state[key]
        if (value === "" || (key !== "q" && value === "all")) next.delete(key)
        else next.set(key, key === "q" ? value.slice(0, 200) : value)
    }
    return next
}
