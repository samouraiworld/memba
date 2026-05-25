import { isWithinInterval } from "date-fns"
import type { TPullRequest } from "./gnoloveSchemas"
import type { ReportTab } from "./gnoloveConstants"
import { TEAMS } from "./gnoloveConstants"
import { extractRepoFromUrl } from "./gnoloveApi"

export function hasActivityInRange(pr: TPullRequest, start: Date, end: Date): boolean {
    const range = { start, end }
    const dates = [pr.createdAt, pr.mergedAt, pr.updatedAt].filter(Boolean) as string[]
    return dates.some(d => {
        try { return isWithinInterval(new Date(d), range) }
        catch { return false }
    })
}

export interface FilterCriteria {
    teamName: string
    selectedRepos: ReadonlySet<string>
    period: string
    start: Date
    end: Date
    activeTab: ReportTab | "all"
    report: {
        merged?: TPullRequest[] | null
        in_progress?: TPullRequest[] | null
        waiting_for_review?: TPullRequest[] | null
        reviewed?: TPullRequest[] | null
        blocked?: TPullRequest[] | null
    } | null | undefined
}

export function filterPrs(prs: TPullRequest[], criteria: FilterCriteria): TPullRequest[] {
    let result = prs

    if (criteria.teamName !== "all") {
        const team = TEAMS.find(t => t.name === criteria.teamName)
        if (team) {
            result = result.filter(pr => pr.authorLogin && team.members.includes(pr.authorLogin))
        }
    }

    if (criteria.selectedRepos.size > 0) {
        result = result.filter(pr => {
            const repo = extractRepoFromUrl(pr.url)
            return repo ? criteria.selectedRepos.has(repo) : false
        })
    }

    if (criteria.period === "weekly") {
        result = result.filter(pr => hasActivityInRange(pr, criteria.start, criteria.end))
    }

    if (criteria.activeTab !== "all") {
        const tabPrs = criteria.report?.[criteria.activeTab] ?? []
        const tabIds = new Set(tabPrs.map(p => p.id))
        result = result.filter(pr => tabIds.has(pr.id))
    }

    return result
}

export function filterPrsByCategory(
    prs: TPullRequest[] | null | undefined,
    teamName: string,
    selectedRepos: ReadonlySet<string>,
    period: string,
    start: Date,
    end: Date,
): TPullRequest[] {
    let result = prs ?? []
    if (teamName !== "all") {
        const team = TEAMS.find(t => t.name === teamName)
        if (team) result = result.filter(pr => pr.authorLogin && team.members.includes(pr.authorLogin))
    }
    if (selectedRepos.size > 0) {
        result = result.filter(pr => {
            const repo = extractRepoFromUrl(pr.url)
            return repo ? selectedRepos.has(repo) : false
        })
    }
    if (period === "weekly") {
        result = result.filter(pr => hasActivityInRange(pr, start, end))
    }
    return result
}
