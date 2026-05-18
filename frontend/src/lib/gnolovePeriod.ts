/**
 * Period selection for team-hub queries.
 *
 * Mirrors the strings the gnolove backend accepts (`daily`, `weekly`,
 * `monthly`, `yearly`, or empty for all-time). Centralized here so the
 * header's period selector, the URL state hook, and the per-card queries
 * all agree on the same vocabulary.
 *
 * @module lib/gnolovePeriod
 */

export const TEAM_HUB_PERIODS = ["all", "yearly", "monthly", "weekly", "daily"] as const

export type TeamHubPeriod = (typeof TEAM_HUB_PERIODS)[number]

export const TEAM_HUB_PERIOD_LABELS: Record<TeamHubPeriod, string> = {
    all: "All time",
    yearly: "Last year",
    monthly: "Last month",
    weekly: "Last week",
    daily: "Last 24h",
}

export const DEFAULT_TEAM_HUB_PERIOD: TeamHubPeriod = "monthly"

export function isTeamHubPeriod(value: unknown): value is TeamHubPeriod {
    return typeof value === "string" && (TEAM_HUB_PERIODS as readonly string[]).includes(value)
}

/**
 * Convert a TeamHubPeriod into the backend's `?time=` value.
 *   "all" → "" (the backend's all-time sentinel)
 *   everything else passes through.
 */
export function periodToBackendParam(period: TeamHubPeriod): string {
    return period === "all" ? "" : period
}

/**
 * Parse a free-form string (typically from a URL) into a TeamHubPeriod,
 * falling back to the default on garbage.
 */
export function parseTeamHubPeriod(raw: string | null | undefined): TeamHubPeriod {
    if (!raw) return DEFAULT_TEAM_HUB_PERIOD
    return isTeamHubPeriod(raw) ? raw : DEFAULT_TEAM_HUB_PERIOD
}

/**
 * Convert a period into the cutoff date (everything strictly after this
 * timestamp counts as "in period"). Returns null for "all", which means
 * "no lower bound" to client-side filters.
 */
export function periodToCutoff(period: TeamHubPeriod, now: Date = new Date()): Date | null {
    const d = new Date(now)
    switch (period) {
        case "daily":   d.setUTCDate(d.getUTCDate() - 1); return d
        case "weekly":  d.setUTCDate(d.getUTCDate() - 7); return d
        case "monthly": d.setUTCMonth(d.getUTCMonth() - 1); return d
        case "yearly":  d.setUTCFullYear(d.getUTCFullYear() - 1); return d
        case "all":
        default:        return null
    }
}
