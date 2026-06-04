import type { TPullRequestReport, TPullRequest, TProposal, TContributorsResponse, TPackage, TNamespace, TGovdaoMember } from "./gnoloveSchemas"
import type { Team, TeamColor } from "./gnoloveConstants"
import { TimeFilter } from "./gnoloveConstants"
import type { TopicRule } from "./gnoloveFocusAreas"
import { computeFocusAreas } from "./gnoloveFocusAreas"
import { extractRepoFromUrl } from "./gnoloveApi"

// ── Types ────────────────────────────────────────────────────

export interface TeamDatum {
    slug: string
    name: string
    score: number
    prs: number
    commits: number
    issues: number
    reviews: number
    color: string
}

export interface ContributionTier {
    label: string
    min: number
    max: number
    count: number
}

export interface VoteDatum {
    name: string
    yes: number
    no: number
    abstain: number
    proposalId: string
}

export interface SummaryStats {
    totalContributors: number
    totalPrs: number
    totalCommits: number
    totalIssues: number
    totalReviews: number
    totalProposals: number
    govdaoMembers: number
    totalPackages: number
    totalNamespaces: number
}

export interface CycleTimeBucket {
    label: string
    max: number
    count: number
}

export interface TopicHeatmapRow {
    topic: string
    counts: number[]
    total: number
}

export interface TopicHeatmapResult {
    months: string[]
    rows: TopicHeatmapRow[]
}

export interface RepoHealthRow {
    repo: string
    prsPerWeek: number
    medianCycleDays: number
    openBacklog: number
    lastActivityDays: number
}

export interface CohortRow {
    month: string
    size: number
    retention: number[]
}

export interface CohortGridResult {
    rows: CohortRow[]
    maxOffset: number
}

export interface CollabMatrixResult {
    teamsList: string[]
    get: (authorTeam: string, reviewerTeam: string) => number
    max: number
}

// ── Aggregators ──────────────────────────────────────────────

export function computeTeamData(
    contributors: TContributorsResponse | undefined,
    teams: readonly Team[],
    teamCssColors: Record<TeamColor, string>,
): TeamDatum[] {
    if (!contributors?.users) return []
    return teams.map(team => {
        const members = contributors.users.filter(u => team.members.includes(u.login))
        return {
            slug: team.slug,
            name: team.name,
            score: members.reduce((s, m) => s + (m.score ?? 0), 0),
            prs: members.reduce((s, m) => s + (m.TotalPrs ?? 0), 0),
            commits: members.reduce((s, m) => s + (m.TotalCommits ?? 0), 0),
            issues: members.reduce((s, m) => s + (m.TotalIssues ?? 0), 0),
            reviews: members.reduce((s, m) => s + (m.TotalReviewedPullRequests ?? 0), 0),
            color: teamCssColors[team.color],
        }
    }).filter(t => t.score > 0).sort((a, b) => b.score - a.score)
}

/**
 * Order a roster of teams by their aggregate contributor score, highest first.
 *
 * Score = sum of member `score` from the supplied `contributors` response, so it
 * reflects whatever time window that response was fetched for (the Teams index
 * fetches the monthly window). Member matching is **case-insensitive** — GitHub
 * logins are — mirroring the Home page's team-card logic.
 *
 * Behavior:
 *  - Active teams (score > 0) first, sorted by score descending.
 *  - Inactive teams (score 0, or no contributor data) are kept and appended in
 *    their original curated order — the index must stay a complete directory.
 *  - If `contributors` is undefined (loading/error), the input order is returned
 *    unchanged so the page never blanks or reshuffles unexpectedly.
 *
 * Pure: returns a new array; never mutates the input.
 */
export function sortTeamsByScore<T extends { members: readonly string[] }>(
    teams: readonly T[],
    contributors: TContributorsResponse | undefined,
): T[] {
    if (!contributors?.users) return [...teams]
    const scoreByLogin = new Map<string, number>()
    for (const u of contributors.users) {
        scoreByLogin.set(u.login.toLowerCase(), u.score ?? 0)
    }
    return teams
        .map((team, index) => {
            const score = team.members.reduce(
                (sum, login) => sum + (scoreByLogin.get(login.toLowerCase()) ?? 0),
                0,
            )
            return { team, score, index }
        })
        .sort((a, b) => {
            // Active teams first by score desc; ties and inactive keep curated order.
            if ((a.score > 0 || b.score > 0) && b.score !== a.score) return b.score - a.score
            return a.index - b.index
        })
        .map(s => s.team)
}

export function computeContributionTiers(
    contributors: TContributorsResponse | undefined,
): ContributionTier[] {
    if (!contributors?.users) return []
    const tiers: ContributionTier[] = [
        { label: "1 PR", min: 1, max: 1, count: 0 },
        { label: "2-5", min: 2, max: 5, count: 0 },
        { label: "6-10", min: 6, max: 10, count: 0 },
        { label: "11-25", min: 11, max: 25, count: 0 },
        { label: "26-50", min: 26, max: 50, count: 0 },
        { label: "50+", min: 51, max: Infinity, count: 0 },
    ]
    for (const user of contributors.users) {
        const prs = user.TotalPrs ?? 0
        if (prs === 0) continue
        const tier = tiers.find(t => prs >= t.min && prs <= t.max)
        if (tier) tier.count++
    }
    return tiers
}

export function computeVoteData(proposals: TProposal[] | undefined): VoteDatum[] {
    if (!proposals?.length) return []
    return proposals
        .filter(p => p.votes.length > 0)
        .slice(0, 20)
        .map(p => {
            const yes = p.votes.filter(v => v.vote === "YES").length
            const no = p.votes.filter(v => v.vote === "NO").length
            const abstain = p.votes.filter(v => v.vote === "ABSTAIN").length
            const label = p.title || `#${p.id.slice(0, 6)}`
            return { name: label.length > 20 ? label.slice(0, 20) + "..." : label, yes, no, abstain, proposalId: p.id }
        })
        .reverse()
}

export function computeStats(
    contributors: TContributorsResponse | undefined,
    proposals: TProposal[] | undefined,
    govdaoMembers: TGovdaoMember[] | undefined,
    packages: TPackage[] | undefined,
    namespaces: TNamespace[] | undefined,
): SummaryStats | null {
    if (!contributors?.users) return null
    const users = contributors.users
    return {
        totalContributors: users.length,
        totalPrs: users.reduce((s, u) => s + (u.TotalPrs ?? 0), 0),
        totalCommits: users.reduce((s, u) => s + (u.TotalCommits ?? 0), 0),
        totalIssues: users.reduce((s, u) => s + (u.TotalIssues ?? 0), 0),
        totalReviews: users.reduce((s, u) => s + (u.TotalReviewedPullRequests ?? 0), 0),
        totalProposals: proposals?.length ?? 0,
        govdaoMembers: govdaoMembers?.length ?? 0,
        totalPackages: packages?.length ?? 0,
        totalNamespaces: namespaces?.length ?? 0,
    }
}

export function computeCycleTimeHistogram(
    merged: TPullRequest[] | null | undefined,
    period: TimeFilter,
    nowMs: number,
): CycleTimeBucket[] {
    const buckets: CycleTimeBucket[] = [
        { label: "<1d",    max: 1,           count: 0 },
        { label: "1-3d",   max: 3,           count: 0 },
        { label: "3-7d",   max: 7,           count: 0 },
        { label: "1-2w",   max: 14,          count: 0 },
        { label: "2-4w",   max: 28,          count: 0 },
        { label: "1-3mo",  max: 90,          count: 0 },
        { label: ">3mo",   max: Number.POSITIVE_INFINITY, count: 0 },
    ]
    if (!merged) return buckets
    const cutoff = (() => {
        switch (period) {
            case TimeFilter.WEEKLY: return nowMs - 7 * 24 * 3_600_000
            case TimeFilter.MONTHLY: return nowMs - 30 * 24 * 3_600_000
            case TimeFilter.YEARLY: return nowMs - 365 * 24 * 3_600_000
            default: return 0
        }
    })()
    for (const pr of merged) {
        if (!pr.mergedAt || !pr.createdAt) continue
        const mergedTs = new Date(pr.mergedAt).getTime()
        if (cutoff > 0 && mergedTs < cutoff) continue
        const created = new Date(pr.createdAt).getTime()
        const days = (mergedTs - created) / 86_400_000
        if (days < 0) continue
        const bucket = buckets.find(b => days <= b.max)
        if (bucket) bucket.count++
    }
    return buckets
}

export function computeTopicHeatmap(
    merged: TPullRequest[] | null | undefined,
    topicRules: TopicRule[],
    nowMs: number,
): TopicHeatmapResult {
    if (!merged) return { months: [], rows: [] }
    const anchor = new Date(nowMs)
    const months: string[] = []
    const monthIndex = new Map<string, number>()
    for (let i = 11; i >= 0; i--) {
        const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
        monthIndex.set(key, months.length)
        months.push(key)
    }
    const counts = new Map<string, number[]>()
    const ensure = (topic: string): number[] => {
        let row = counts.get(topic)
        if (!row) { row = new Array(months.length).fill(0); counts.set(topic, row) }
        return row
    }
    for (const pr of merged) {
        if (!pr.mergedAt) continue
        const monthKey = pr.mergedAt.slice(0, 7)
        const m = monthIndex.get(monthKey)
        if (m === undefined) continue
        const repo = extractRepoFromUrl(pr.url)
        const pills = computeFocusAreas([{ repo, title: pr.title }], topicRules)
        const topic = pills[0]?.topic ?? "other"
        ensure(topic)[m]++
    }
    const rows = Array.from(counts.entries())
        .map(([topic, topicCounts]) => ({
            topic,
            counts: topicCounts,
            total: topicCounts.reduce((s, n) => s + n, 0),
        }))
        .filter(r => {
            if (r.topic !== "other") return true
            const grandTotal = Array.from(counts.values()).reduce(
                (s, row) => s + row.reduce((a, b) => a + b, 0), 0,
            )
            return grandTotal > 0 && r.total / grandTotal > 0.05
        })
        .sort((a, b) => b.total - a.total)
    return { months, rows }
}

export function topicHeatmapMax(heatmap: TopicHeatmapResult): number {
    let max = 0
    for (const r of heatmap.rows) for (const c of r.counts) if (c > max) max = c
    return max
}

export function computeRepoHealth(
    yearReport: TPullRequestReport | undefined,
    nowMs: number,
): RepoHealthRow[] {
    if (!yearReport?.merged) return []
    type Bucket = { merged: number[]; cycleDays: number[]; lastMerged: number; openBacklog: number }
    const byRepo = new Map<string, Bucket>()
    for (const pr of yearReport.merged) {
        const repo = extractRepoFromUrl(pr.url)
        if (!repo || !pr.mergedAt) continue
        const mergedTs = new Date(pr.mergedAt).getTime()
        const created = pr.createdAt ? new Date(pr.createdAt).getTime() : mergedTs
        const days = (mergedTs - created) / 86_400_000
        let row = byRepo.get(repo)
        if (!row) { row = { merged: [], cycleDays: [], lastMerged: 0, openBacklog: 0 }; byRepo.set(repo, row) }
        row.merged.push(mergedTs)
        row.cycleDays.push(days)
        if (mergedTs > row.lastMerged) row.lastMerged = mergedTs
    }
    for (const bucket of ["in_progress", "waiting_for_review", "reviewed", "blocked"] as const) {
        for (const pr of yearReport[bucket] ?? []) {
            const repo = extractRepoFromUrl(pr.url)
            if (!repo) continue
            let row = byRepo.get(repo)
            if (!row) { row = { merged: [], cycleDays: [], lastMerged: 0, openBacklog: 0 }; byRepo.set(repo, row) }
            row.openBacklog++
        }
    }
    const oneYearAgo = nowMs - 365 * 24 * 3_600_000
    return Array.from(byRepo.entries())
        .map(([repo, b]) => {
            const weeksCovered = Math.max(1, (nowMs - oneYearAgo) / (7 * 24 * 3_600_000))
            const sortedCycles = [...b.cycleDays].sort((a, c) => a - c)
            const median = sortedCycles.length === 0
                ? 0
                : sortedCycles[Math.floor(sortedCycles.length / 2)]
            return {
                repo,
                prsPerWeek: b.merged.length / weeksCovered,
                medianCycleDays: median,
                openBacklog: b.openBacklog,
                lastActivityDays: b.lastMerged === 0 ? Number.POSITIVE_INFINITY : (nowMs - b.lastMerged) / 86_400_000,
            }
        })
        .filter(r => r.prsPerWeek > 0 || r.openBacklog > 0)
        .sort((a, b) => b.prsPerWeek - a.prsPerWeek)
        .slice(0, 15)
}

export function computeCohortGrid(cohortsData: { cohorts: CohortRow[] } | undefined): CohortGridResult {
    const rows = cohortsData?.cohorts ?? []
    if (rows.length === 0) return { rows: [], maxOffset: 0 }
    let maxOffset = 0
    for (const r of rows) {
        if (r.retention.length - 1 > maxOffset) maxOffset = r.retention.length - 1
    }
    const sorted = [...rows].sort((a, b) => b.month.localeCompare(a.month))
    return { rows: sorted, maxOffset }
}

export interface TeamCollabData {
    teams?: string[]
    cells?: { authorTeam: string; reviewerTeam: string; reviews: number }[]
    period?: string
    outsiderReviewsByAuthorTeam?: Record<string, number>
    outsiderReviewsByReviewerTeam?: Record<string, number>
}

export function computeCollabMatrix(teamCollabData: TeamCollabData | undefined): CollabMatrixResult {
    const teamsList = teamCollabData?.teams ?? []
    const cells = teamCollabData?.cells ?? []
    const map = new Map<string, number>()
    let max = 0
    for (const c of cells) {
        const key = `${c.authorTeam}|${c.reviewerTeam}`
        map.set(key, (map.get(key) ?? 0) + c.reviews)
        if (map.get(key)! > max) max = map.get(key)!
    }
    return { teamsList, get: (a: string, r: string) => map.get(`${a}|${r}`) ?? 0, max }
}

export function computeSparklines(monthlyActivity: { merged: number; open: number; inReview: number }[] | undefined): {
    merged: number[]
    open: number[]
} {
    if (!monthlyActivity?.length) return { merged: [], open: [] }
    return {
        merged: monthlyActivity.map(m => m.merged),
        open: monthlyActivity.map(m => m.open + m.inReview),
    }
}
