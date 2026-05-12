/**
 * GnoloveReport — PR status report with team/repo filters, two views, and export.
 *
 * Every filter (period, at, tab, team, repos, view) lives in the URL via
 * `useReportUrlState`. The URL is the artifact: copy it from the address bar
 * (or via Copy Link) and the recipient sees the same view. See
 * docs/planning/GNOLOVE_SHAREABLE_REPORT_URLS_PLAN.md.
 *
 * History strategy: coarse-axis changes (period/at/team/tab/repos) use push so
 * Back walks back through filter changes; `view` toggle uses replace.
 *
 * @module pages/gnolove/GnoloveReport
 */

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import {
    addWeeks, addMonths, addYears,
    format, isFuture, getISOWeek, getISOWeekYear, isWithinInterval,
} from "date-fns"
import { useGnoloveReport, useGnoloveRepositories, useReportUrlState } from "../../hooks/gnolove"
import { PageMeta } from "../../components/gnolove/PageMeta"
import { REPORT_TAB_LABELS, TEAMS, TEAM_CSS_COLORS } from "../../lib/gnoloveConstants"
import type { ReportTab, Team } from "../../lib/gnoloveConstants"
import type { TPullRequest } from "../../lib/gnoloveSchemas"
import { exportToCSV, exportToMarkdown, exportToPDF } from "../../lib/gnoloveExport"
import { extractRepoFromUrl } from "../../lib/gnoloveApi"
import {
    rangeFromKey, defaultKey, nextAtForPeriodSwitch,
    weekKeyFromDate, monthKeyFromDate, yearKeyFromDate,
    buildShareUrl,
    DEFAULT_REPORT_STATE,
    type ReportPeriod, type ReportUrlState,
} from "../../lib/gnoloveReportUrl"
import { useNetworkKey } from "../../hooks/useNetworkNav"

const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
    weekly: "Weekly",
    monthly: "Monthly",
    yearly: "Yearly",
    all_time: "All Time",
}

type PRStatus = "merged" | "in_progress" | "waiting_for_review" | "reviewed" | "blocked"

interface ReportData {
    merged?: TPullRequest[] | null
    in_progress?: TPullRequest[] | null
    waiting_for_review?: TPullRequest[] | null
    reviewed?: TPullRequest[] | null
    blocked?: TPullRequest[] | null
}

/** Derive a PR's status from the report buckets (used by PRStateBadge) [MF / BUG-4]. */
function statusFor(pr: TPullRequest, report: ReportData | null | undefined): PRStatus {
    if (pr.mergedAt || pr.state === "MERGED") return "merged"
    if (report?.blocked?.some(p => p.id === pr.id)) return "blocked"
    if (report?.waiting_for_review?.some(p => p.id === pr.id)) return "waiting_for_review"
    if (report?.reviewed?.some(p => p.id === pr.id)) return "reviewed"
    return "in_progress"
}

/** Check if a PR had any activity within the given date range. */
function hasActivityInRange(pr: TPullRequest, start: Date, end: Date): boolean {
    const range = { start, end }
    const dates = [pr.createdAt, pr.mergedAt, pr.updatedAt].filter(Boolean) as string[]
    return dates.some(d => {
        try { return isWithinInterval(new Date(d), range) }
        catch { return false }
    })
}

export default function GnoloveReport() {
    const [urlState, setUrlState] = useReportUrlState()
    const { period, at, tab: activeTab, team: teamOrNull, repos: selectedRepos, view } = urlState
    const selectedTeam = teamOrNull ?? "all"
    const networkKey = useNetworkKey()

    // Ephemeral UI state — stays local (not in URL).
    const [repoDropdownOpen, setRepoDropdownOpen] = useState(false)
    const repoDropdownRef = useRef<HTMLDivElement>(null)
    const [copiedLink, setCopiedLink] = useState(false)

    // Close repo dropdown on outside click or Escape key
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (repoDropdownRef.current && !repoDropdownRef.current.contains(e.target as Node)) {
                setRepoDropdownOpen(false)
            }
        }
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") setRepoDropdownOpen(false)
        }
        document.addEventListener("mousedown", handleClick)
        document.addEventListener("keydown", handleKeyDown)
        return () => {
            document.removeEventListener("mousedown", handleClick)
            document.removeEventListener("keydown", handleKeyDown)
        }
    }, [])

    const { data: repos } = useGnoloveRepositories()

    // Derived absolute date range. `at ?? defaultKey(period)` handles the
    // "default state" case where the URL doesn't pin a specific period.
    const { start, end } = useMemo(
        () => rangeFromKey(period, at ?? defaultKey(period)),
        [period, at],
    )

    const { data: report, isLoading, isError: reportError, refetch } = useGnoloveReport(start, end)

    // Stale-repo banner [MF-2 / BUG-2]: URL pinned a repo that's not in the server response.
    const missingRepos = useMemo(() => {
        if (!repos || selectedRepos.length === 0) return []
        const known = new Set(repos.map(r => `${r.owner}/${r.name}`))
        return selectedRepos.filter(r => !known.has(r))
    }, [repos, selectedRepos])

    // Stale-team banner [MF-18 / R-12]: URL pinned ?team=Foo where Foo isn't a known team
    // (parser coerces to null, but we surface the raw value to the user).
    const [searchParams] = useSearchParams()
    const rawTeam = searchParams.get("team")
    const staleTeamName = rawTeam && rawTeam !== "all" && teamOrNull === null ? rawTeam : null

    // Repo Set for filter lookups (created lazily; URL state is readonly string[])
    const selectedReposSet = useMemo(() => new Set(selectedRepos), [selectedRepos])

    const prs: TPullRequest[] = useMemo(() => {
        if (!report) return []
        return [
            ...(report.merged ?? []),
            ...(report.in_progress ?? []),
            ...(report.waiting_for_review ?? []),
            ...(report.reviewed ?? []),
            ...(report.blocked ?? []),
        ]
    }, [report])

    const filteredPrs = useMemo(() => {
        let result = prs

        if (selectedTeam !== "all") {
            const team = TEAMS.find(t => t.name === selectedTeam)
            if (team) {
                result = result.filter(pr => pr.authorLogin && team.members.includes(pr.authorLogin))
            }
        }

        if (selectedReposSet.size > 0) {
            result = result.filter(pr => {
                const repo = extractRepoFromUrl(pr.url)
                return repo ? selectedReposSet.has(repo) : false
            })
        }

        if (period === "weekly") {
            result = result.filter(pr => hasActivityInRange(pr, start, end))
        }

        if (activeTab !== "all") {
            const tabPrs = report?.[activeTab] ?? []
            const tabIds = new Set(tabPrs.map(p => p.id))
            result = result.filter(pr => tabIds.has(pr.id))
        }

        return result
    }, [prs, selectedTeam, selectedReposSet, period, start, end, activeTab, report])

    const counts = useMemo(() => {
        if (!report) return {} as Record<ReportTab | "all", number>
        const merged = report.merged?.length ?? 0
        const inProgress = report.in_progress?.length ?? 0
        const waitingForReview = report.waiting_for_review?.length ?? 0
        const reviewed = report.reviewed?.length ?? 0
        const blocked = report.blocked?.length ?? 0
        return {
            all: merged + inProgress + waitingForReview + reviewed + blocked,
            merged,
            in_progress: inProgress,
            waiting_for_review: waitingForReview,
            reviewed,
            blocked,
        }
    }, [report])

    // Empty-state reason for UX-2 messaging.
    const emptyReason = useMemo((): EmptyReason => {
        if (!report) return "loading"
        if (filteredPrs.length > 0) return null
        const totalReportPrs =
            (report.merged?.length ?? 0) + (report.in_progress?.length ?? 0) +
            (report.waiting_for_review?.length ?? 0) + (report.reviewed?.length ?? 0) +
            (report.blocked?.length ?? 0)
        if (totalReportPrs === 0) return "no_data"
        if (selectedTeam !== "all" && selectedReposSet.size > 0) return "team_and_repo"
        if (selectedTeam !== "all") return "team"
        if (selectedReposSet.size > 0) return "repo"
        return "filter"
    }, [report, filteredPrs, selectedTeam, selectedReposSet])

    const canGoForward = period !== "all_time" && !isFuture(
        period === "weekly" ? addWeeks(start, 1) :
        period === "monthly" ? addMonths(start, 1) :
        addYears(start, 1)
    )

    const dateLabel = useMemo(() => {
        switch (period) {
            case "weekly":
                return `${format(start, "MMM d")} — ${format(end, "MMM d, yyyy")}`
            case "monthly":
                return format(start, "MMMM yyyy")
            case "yearly":
                return format(start, "yyyy")
            case "all_time":
                return "All Time"
        }
    }, [period, start, end])

    // Contextual page title that reflects the active filters.
    const pageTitle = useMemo(() => {
        const parts = ["PR Report"]
        if (selectedTeam !== "all") parts.push(selectedTeam)
        parts.push(dateLabel)
        return `${parts.join(" · ")} | Gnolove · Memba`
    }, [selectedTeam, dateLabel])

    function handlePeriodChange(p: ReportPeriod) {
        setUrlState({ period: p, at: nextAtForPeriodSwitch(period, at, p) })
    }

    function toggleRepo(repo: string) {
        const next = selectedReposSet.has(repo)
            ? selectedRepos.filter(r => r !== repo)
            : [...selectedRepos, repo].sort()
        setUrlState({ repos: next })
    }

    const stepBy = useCallback(
        (delta: number) => {
            const moved =
                period === "weekly"  ? addWeeks(start, delta) :
                period === "monthly" ? addMonths(start, delta) :
                period === "yearly"  ? addYears(start, delta) :
                start
            setUrlState({
                at:
                    period === "weekly"  ? weekKeyFromDate(moved) :
                    period === "monthly" ? monthKeyFromDate(moved) :
                    period === "yearly"  ? yearKeyFromDate(moved) :
                    null,
            })
        },
        [period, start, setUrlState],
    )

    function handleViewToggle(v: "report" | "table") {
        setUrlState({ view: v })
    }

    // "Copy link" emits a pinned URL reconstructed from validated state [MF-3].
    const handleCopyLink = useCallback(async () => {
        const url = buildShareUrl(window.location.origin, networkKey, urlState)
        try {
            if (typeof navigator !== "undefined" && navigator.share && /mobile/i.test(navigator.userAgent)) {
                await navigator.share({ url, title: "Gnolove PR Report" })
            } else {
                await navigator.clipboard.writeText(url)
            }
            setCopiedLink(true)
            setTimeout(() => setCopiedLink(false), 1500)
        } catch {
            // user dismissed share sheet or clipboard blocked — silent no-op
        }
    }, [networkKey, urlState])

    function clearAllFilters() {
        setUrlState(DEFAULT_REPORT_STATE)
    }
    function clearTeam() { setUrlState({ team: null }) }
    function clearRepos() { setUrlState({ repos: [] }) }
    function clearTab() { setUrlState({ tab: "all" }) }

    function dismissStaleRepos() {
        setUrlState({ repos: selectedRepos.filter(r => !missingRepos.includes(r)) })
    }

    return (
        <div className="gl-page">
            <PageMeta title={pageTitle} description={`PR activity report for ${dateLabel} on the Gno ecosystem.`} />
            <div className="gl-header">
                <h1 className="gl-title">📋 PR Report</h1>
                <div className="gl-report-actions">
                    <div className="gl-view-toggle" role="tablist" aria-label="View mode">
                        <button
                            className={`gl-view-btn ${view === "report" ? "gl-view-btn--active" : ""}`}
                            onClick={() => handleViewToggle("report")}
                            aria-pressed={view === "report"}
                        >
                            Report
                        </button>
                        <button
                            className={`gl-view-btn ${view === "table" ? "gl-view-btn--active" : ""}`}
                            onClick={() => handleViewToggle("table")}
                            aria-pressed={view === "table"}
                        >
                            Table
                        </button>
                    </div>
                    <button
                        className="gl-export-btn"
                        onClick={handleCopyLink}
                        aria-live="polite"
                    >
                        {copiedLink ? "✓ Link copied" : "🔗 Copy link"}
                    </button>
                    <button
                        className="gl-export-btn"
                        onClick={() => exportToCSV(filteredPrs, activeTab, format(start, "yyyy-MM-dd"))}
                        disabled={filteredPrs.length === 0}
                    >
                        Export CSV
                    </button>
                    <button
                        className="gl-export-btn"
                        onClick={() => exportToMarkdown(filteredPrs, activeTab, dateLabel)}
                        disabled={filteredPrs.length === 0}
                    >
                        Export MD
                    </button>
                    <button
                        className="gl-export-btn"
                        onClick={() => exportToPDF(filteredPrs, activeTab, dateLabel)}
                        disabled={filteredPrs.length === 0}
                    >
                        Export PDF
                    </button>
                </div>
            </div>

            {/* ── Error Banner ────────────────────────────────── */}
            {reportError && !isLoading && (
                <div className="gl-error-banner">
                    <span>⚠️ Failed to load report data — the Gnolove backend may be unavailable.</span>
                    <button className="gl-error-retry" onClick={() => refetch()}>Retry</button>
                </div>
            )}

            {/* ── Stale-repo / stale-team banners [BUG-2, R-12] ── */}
            {missingRepos.length > 0 && (
                <div className="gl-warning-banner" role="alert">
                    <span>
                        ⚠️ The shared link references {missingRepos.length === 1 ? "a repository" : "repositories"}{" "}
                        <strong>{missingRepos.join(", ")}</strong> that {missingRepos.length === 1 ? "is" : "are"} not in the current dataset.
                    </span>
                    <button className="gl-error-retry" onClick={dismissStaleRepos}>Remove from filter</button>
                </div>
            )}
            {staleTeamName && (
                <div className="gl-warning-banner" role="alert">
                    <span>
                        ⚠️ Team <strong>{staleTeamName}</strong> from the shared link doesn&apos;t exist anymore.
                        Showing all teams.
                    </span>
                </div>
            )}

            {/* Period Tabs */}
            <div className="gl-tabs" role="tablist" aria-label="Time period">
                {(Object.entries(REPORT_PERIOD_LABELS) as [ReportPeriod, string][]).map(([key, label]) => (
                    <button
                        key={key}
                        className={`gl-tab ${period === key ? "gl-tab--active" : ""}`}
                        onClick={() => handlePeriodChange(key)}
                        aria-current={period === key ? "page" : undefined}
                        role="tab"
                        aria-selected={period === key}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* Date Navigator */}
            {period !== "all_time" && (
                <div className="gl-week-nav">
                    <button className="gl-week-btn" onClick={() => stepBy(-1)} aria-label="Previous">← Previous</button>
                    <span className="gl-week-label">{dateLabel}</span>
                    <button
                        className="gl-week-btn"
                        onClick={() => stepBy(1)}
                        disabled={!canGoForward}
                        aria-label="Next"
                    >
                        Next →
                    </button>
                </div>
            )}

            {/* Filters */}
            <div className="gl-report-filters">
                <select
                    className="gl-filter-select"
                    value={selectedTeam}
                    onChange={e => setUrlState({ team: e.target.value === "all" ? null : e.target.value })}
                    aria-label="Filter by team"
                >
                    <option value="all">All Teams</option>
                    {TEAMS.map(team => (
                        <option key={team.name} value={team.name}>{team.name}</option>
                    ))}
                </select>

                {/* Multi-select repo filter */}
                <div className="gl-repo-multiselect" ref={repoDropdownRef}>
                    <button
                        className="gl-filter-select gl-repo-multiselect-btn"
                        onClick={() => setRepoDropdownOpen(o => !o)}
                        type="button"
                        aria-haspopup="listbox"
                        aria-expanded={repoDropdownOpen}
                        aria-label="Filter by repository"
                    >
                        {selectedReposSet.size === 0
                            ? "All Repositories"
                            : `${selectedReposSet.size} repo${selectedReposSet.size > 1 ? "s" : ""} selected`}
                        <span className="gl-repo-multiselect-arrow">{repoDropdownOpen ? "▲" : "▼"}</span>
                    </button>
                    {repoDropdownOpen && (
                        <div className="gl-repo-multiselect-dropdown" role="listbox">
                            <label className="gl-repo-multiselect-option gl-repo-multiselect-option--all">
                                <input
                                    type="checkbox"
                                    checked={selectedReposSet.size === 0}
                                    onChange={() => setUrlState({ repos: [] })}
                                />
                                <span>All Repositories</span>
                            </label>
                            {repos?.map(repo => {
                                const key = `${repo.owner}/${repo.name}`
                                return (
                                    <label key={repo.id} className="gl-repo-multiselect-option">
                                        <input
                                            type="checkbox"
                                            checked={selectedReposSet.has(key)}
                                            onChange={() => toggleRepo(key)}
                                        />
                                        <span>{key}</span>
                                    </label>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Status Tabs */}
            <div className="gl-tabs" role="tablist" aria-label="Status filter">
                <button
                    className={`gl-tab ${activeTab === "all" ? "gl-tab--active" : ""}`}
                    onClick={() => setUrlState({ tab: "all" })}
                    aria-current={activeTab === "all" ? "true" : undefined}
                    role="tab"
                    aria-selected={activeTab === "all"}
                >
                    All
                    {counts.all != null && <span className="gl-tab-count">{counts.all}</span>}
                </button>
                {(Object.entries(REPORT_TAB_LABELS) as [ReportTab, string][]).map(([key, label]) => (
                    <button
                        key={key}
                        className={`gl-tab ${activeTab === key ? "gl-tab--active" : ""}`}
                        onClick={() => setUrlState({ tab: key })}
                        aria-current={activeTab === key ? "true" : undefined}
                        role="tab"
                        aria-selected={activeTab === key}
                    >
                        {label}
                        {counts[key] != null && (
                            <span className="gl-tab-count">{counts[key]}</span>
                        )}
                    </button>
                ))}
            </div>

            {/* Content: Table or Report view */}
            {isLoading ? (
                <div className="gl-section">
                    <div className="gl-loading">
                        <div className="gl-skeleton" /><div className="gl-skeleton" /><div className="gl-skeleton" />
                    </div>
                </div>
            ) : view === "report" ? (
                <NarrativeReportView
                    report={report}
                    period={period}
                    start={start}
                    end={end}
                    selectedTeam={selectedTeam}
                    selectedRepos={selectedReposSet}
                    urlState={urlState}
                    networkKey={networkKey}
                    emptyReason={emptyReason}
                    onClearTeam={clearTeam}
                    onClearRepos={clearRepos}
                    onClearAll={clearAllFilters}
                />
            ) : (
                <div className="gl-section">
                    {filteredPrs.length === 0 ? (
                        <EmptyStateMessage
                            reason={emptyReason}
                            selectedTeam={selectedTeam}
                            selectedRepos={selectedRepos}
                            activeTab={activeTab}
                            onClearTeam={clearTeam}
                            onClearRepos={clearRepos}
                            onClearTab={clearTab}
                            onClearAll={clearAllFilters}
                        />
                    ) : (
                        <div className="gl-pr-list">
                            {filteredPrs.map(pr => (
                                <a key={pr.id} href={pr.url} target="_blank" rel="noopener noreferrer" className="gl-pr-row">
                                    {pr.authorAvatarUrl && (
                                        <img src={pr.authorAvatarUrl} alt="" className="gl-pr-avatar" loading="lazy" />
                                    )}
                                    <div className="gl-pr-info">
                                        <span className="gl-pr-title">{pr.title}</span>
                                        <span className="gl-pr-meta">
                                            #{pr.number}
                                            {pr.authorLogin && ` by @${pr.authorLogin}`}
                                            {pr.isDraft && " · Draft"}
                                            {pr.reviewDecision && ` · ${pr.reviewDecision}`}
                                        </span>
                                    </div>
                                    <PRStateBadge status={statusFor(pr, report)} />
                                </a>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// ── Empty state messaging (UX-2) ──────────────────────────────

type EmptyReason = null | "loading" | "no_data" | "team" | "repo" | "team_and_repo" | "filter"

function EmptyStateMessage({
    reason, selectedTeam, selectedRepos, activeTab,
    onClearTeam, onClearRepos, onClearTab, onClearAll,
}: {
    reason: EmptyReason
    selectedTeam: string
    selectedRepos: readonly string[]
    activeTab: ReportTab | "all"
    onClearTeam: () => void
    onClearRepos: () => void
    onClearTab: () => void
    onClearAll: () => void
}) {
    if (!reason || reason === "loading") {
        return <div className="gl-empty">No pull requests in this category for the selected period.</div>
    }
    if (reason === "no_data") {
        return (
            <div className="gl-empty">
                <p>No PR activity in this period.</p>
                <p className="gl-empty__hint">Try widening the period or selecting all repositories.</p>
                <button className="gl-empty__btn" onClick={onClearAll}>Reset filters</button>
            </div>
        )
    }
    if (reason === "team_and_repo") {
        return (
            <div className="gl-empty">
                <p><strong>{selectedTeam}</strong> didn&apos;t ship in <strong>{selectedRepos.join(", ")}</strong> during this period.</p>
                <div className="gl-empty__actions">
                    <button className="gl-empty__btn" onClick={onClearTeam}>Clear team</button>
                    <button className="gl-empty__btn" onClick={onClearRepos}>Clear repos</button>
                    <button className="gl-empty__btn" onClick={onClearAll}>Reset all</button>
                </div>
            </div>
        )
    }
    if (reason === "team") {
        return (
            <div className="gl-empty">
                <p>No PRs from <strong>{selectedTeam}</strong> in this period.</p>
                <button className="gl-empty__btn" onClick={onClearTeam}>Clear team filter</button>
            </div>
        )
    }
    if (reason === "repo") {
        return (
            <div className="gl-empty">
                <p>No PRs in <strong>{selectedRepos.join(", ")}</strong> for this period.</p>
                <button className="gl-empty__btn" onClick={onClearRepos}>Show all repositories</button>
            </div>
        )
    }
    // reason === "filter"
    return (
        <div className="gl-empty">
            <p>No PRs match <strong>{activeTab.replace(/_/g, " ")}</strong> in this period.</p>
            <button className="gl-empty__btn" onClick={onClearTab}>Show all statuses</button>
        </div>
    )
}
// ── Narrative Report View ─────────────────────────────────────

function NarrativeReportView({
    report, period, start, end, selectedTeam, selectedRepos,
    urlState, networkKey,
    emptyReason, onClearTeam, onClearRepos, onClearAll,
}: {
    report: ReportData | null | undefined
    period: ReportPeriod
    start: Date
    end: Date
    selectedTeam: string
    selectedRepos: Set<string>
    urlState: ReportUrlState
    networkKey: string
    emptyReason: EmptyReason
    onClearTeam: () => void
    onClearRepos: () => void
    onClearAll: () => void
}) {
    const [copied, setCopied] = useState(false)

    // Apply team/repo/scope filters to each category
    const filterPrs = useCallback((prs: TPullRequest[] | null | undefined): TPullRequest[] => {
        let result = prs ?? []
        if (selectedTeam !== "all") {
            const team = TEAMS.find(t => t.name === selectedTeam)
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
    }, [selectedTeam, selectedRepos, period, start, end])

    const merged = useMemo(() => filterPrs(report?.merged), [report, filterPrs])
    const inProgress = useMemo(() => filterPrs(report?.in_progress), [report, filterPrs])
    const waitingForReview = useMemo(() => filterPrs(report?.waiting_for_review), [report, filterPrs])
    const reviewed = useMemo(() => filterPrs(report?.reviewed), [report, filterPrs])
    const blocked = useMemo(() => filterPrs(report?.blocked), [report, filterPrs])

    const allPrs = useMemo(
        () => [...merged, ...inProgress, ...waitingForReview, ...reviewed, ...blocked],
        [merged, inProgress, waitingForReview, reviewed, blocked],
    )

    const contributors = useMemo(() => {
        const set = new Set<string>()
        for (const pr of allPrs) if (pr.authorLogin) set.add(pr.authorLogin)
        return Array.from(set).sort()
    }, [allPrs])

    // Highlights: top 5 most-recently merged PRs [BUG-3 — was sorted by title.length].
    const topMerged = useMemo(
        () => [...merged]
            .sort((a, b) => {
                const ta = a.mergedAt ? new Date(a.mergedAt).getTime() : 0
                const tb = b.mergedAt ? new Date(b.mergedAt).getTime() : 0
                return tb - ta
            })
            .slice(0, 5),
        [merged],
    )

    const getTeamForUser = (login: string): Team | undefined =>
        TEAMS.find(t => t.members.includes(login))

    // Period-aware report ID [BUG-6: was always weekId regardless of period].
    const reportId = useMemo(() => {
        switch (period) {
            case "weekly":   return `${getISOWeekYear(start)}-W${String(getISOWeek(start)).padStart(2, "0")}`
            case "monthly":  return format(start, "yyyy-MM")
            case "yearly":   return format(start, "yyyy")
            case "all_time": return "all-time"
        }
    }, [period, start])

    const teamLabel = selectedTeam === "all" ? "All contributors" : selectedTeam
    const periodHeader = useMemo(() => {
        switch (period) {
            case "weekly":
                return `From ${format(start, "dd/MM")} to ${format(end, "dd/MM")} : ${teamLabel}`
            case "monthly":
                return `Monthly Report — ${format(start, "MMMM yyyy")} : ${teamLabel}`
            case "yearly":
                return `Annual Report — ${format(start, "yyyy")} : ${teamLabel}`
            case "all_time":
                return `All Time Report : ${teamLabel}`
        }
    }, [period, start, end, teamLabel])

    const generateReportMd = useCallback((): string => {
        const filterUrl = buildShareUrl(window.location.origin, networkKey, urlState, { stripView: true })
        const lines: string[] = [
            periodHeader,
            "",
            "## Stats", "",
            `- PRs Merged: ${merged.length}`,
            `- Waiting for Review: ${waitingForReview.length + reviewed.length}`,
            `- In Progress: ${inProgress.length}`,
            `- Blocked: ${blocked.length}`,
            `- Contributors Active: ${contributors.length}`,
            "", "---", "",
            "## ⭐ Highlights", "",
        ]
        if (topMerged.length > 0) {
            for (const pr of topMerged) {
                lines.push(`- **${pr.title}** - ${pr.url} - ${pr.authorLogin || "unknown"}`)
            }
        } else {
            lines.push("None this period.")
        }
        lines.push("", "---", "")

        const allWaiting = [...waitingForReview, ...reviewed]
        if (allWaiting.length > 0) {
            lines.push("## 📋 Waiting for Review", "")
            for (const pr of allWaiting) {
                lines.push(`- ${pr.title} - ${pr.url} - ${pr.authorLogin || "unknown"}`)
            }
            lines.push("", "---", "")
        }
        if (inProgress.length > 0) {
            lines.push("## 🚧 In Progress", "")
            for (const pr of inProgress) {
                lines.push(`- ${pr.title} - ${pr.url} - ${pr.authorLogin || "unknown"}`)
            }
            lines.push("", "---", "")
        }
        if (blocked.length > 0) {
            lines.push("## 🚧 Blockers", "")
            for (const pr of blocked) {
                lines.push(`- ${pr.title} - ${pr.url} - ${pr.authorLogin || "unknown"}`)
            }
            lines.push("", "---", "")
        }
        if (merged.length > 0) {
            lines.push("## 🎉 Merged", "")
            for (const pr of merged) {
                lines.push(`- ${pr.title} - ${pr.url} - ${pr.authorLogin || "unknown"}`)
            }
            lines.push("", "---", "")
        }
        lines.push(
            `## 👥 Active Contributors (${contributors.length})`, "",
            contributors.map(login => `@${login}`).join(" · "),
            "", "---",
            `_Generated by Gnolove · ${reportId}_`,
            `_Filter URL: ${filterUrl}_`,
        )
        return lines.join("\n")
    }, [
        periodHeader, merged, topMerged, inProgress, waitingForReview, reviewed,
        blocked, contributors, reportId, urlState, networkKey,
    ])

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(generateReportMd()).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        })
    }, [generateReportMd])

    const handleDownload = useCallback(() => {
        const blob = new Blob([generateReportMd()], { type: "text/markdown" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        const prefix =
            period === "monthly" ? "monthly-report" :
            period === "yearly" ? "annual-report" :
            period === "all_time" ? "all-time-report" :
            "weekly-report"
        a.download = `${prefix}-${reportId}.md`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }, [generateReportMd, reportId, period])

    if (allPrs.length === 0) {
        return (
            <div className="gl-section">
                <EmptyStateMessage
                    reason={emptyReason}
                    selectedTeam={selectedTeam}
                    selectedRepos={Array.from(selectedRepos)}
                    activeTab="all"
                    onClearTeam={onClearTeam}
                    onClearRepos={onClearRepos}
                    onClearTab={() => { /* no-op for narrative view */ }}
                    onClearAll={onClearAll}
                />
            </div>
        )
    }

    return (
        <div className="gl-report-narrative">
            <div className="gl-report-narrative__actions">
                <button className="gl-export-btn" onClick={handleCopy}>
                    {copied ? "✓ Copied!" : "Copy as Markdown"}
                </button>
                <button className="gl-export-btn" onClick={handleDownload}>
                    Download .md
                </button>
                <span className="gl-report-narrative__week-id">{reportId}</span>
            </div>

            <div className="gl-report-narrative__period-header">{periodHeader}</div>

            <section className="gl-report-narrative__section">
                <h2 className="gl-report-narrative__heading">📊 Stats</h2>
                <div className="gl-report-narrative__stats">
                    <div className="gl-report-narrative__stat">
                        <span className="gl-report-narrative__stat-value">{merged.length}</span>
                        <span className="gl-report-narrative__stat-label">Merged</span>
                    </div>
                    <div className="gl-report-narrative__stat">
                        <span className="gl-report-narrative__stat-value">{waitingForReview.length + reviewed.length}</span>
                        <span className="gl-report-narrative__stat-label">Waiting</span>
                    </div>
                    <div className="gl-report-narrative__stat">
                        <span className="gl-report-narrative__stat-value">{inProgress.length}</span>
                        <span className="gl-report-narrative__stat-label">In Progress</span>
                    </div>
                    {blocked.length > 0 && (
                        <div className="gl-report-narrative__stat gl-report-narrative__stat--blocked">
                            <span className="gl-report-narrative__stat-value">{blocked.length}</span>
                            <span className="gl-report-narrative__stat-label">Blocked</span>
                        </div>
                    )}
                    <div className="gl-report-narrative__stat">
                        <span className="gl-report-narrative__stat-value">{contributors.length}</span>
                        <span className="gl-report-narrative__stat-label">Contributors</span>
                    </div>
                </div>
            </section>

            <section className="gl-report-narrative__section">
                <h2 className="gl-report-narrative__heading">⭐ Highlights</h2>
                {topMerged.length > 0 ? (
                    <ul className="gl-report-narrative__list">
                        {topMerged.map(pr => (
                            <li key={pr.id}>
                                <a href={pr.url} target="_blank" rel="noopener noreferrer">#{pr.number}</a>: <strong>{pr.title}</strong>
                                {pr.authorLogin && <span className="gl-report-narrative__author"> @{pr.authorLogin}</span>}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="gl-report-narrative__empty">No merged PRs this period.</p>
                )}
            </section>

            {(waitingForReview.length + reviewed.length) > 0 && (
                <section className="gl-report-narrative__section">
                    <h2 className="gl-report-narrative__heading">📋 Waiting for Review ({waitingForReview.length + reviewed.length})</h2>
                    <ul className="gl-report-narrative__list">
                        {[...waitingForReview, ...reviewed].map(pr => (
                            <li key={pr.id}>
                                <a href={pr.url} target="_blank" rel="noopener noreferrer">#{pr.number}</a>: {pr.title}
                                {pr.authorLogin && <span className="gl-report-narrative__author"> @{pr.authorLogin}</span>}
                                {pr.reviewDecision && (
                                    <span className={`gl-pr-state gl-pr-state--${pr.reviewDecision === "APPROVED" ? "open" : "waiting"}`} style={{ marginLeft: 6 }}>
                                        {pr.reviewDecision === "APPROVED" ? "Approved" : pr.reviewDecision === "CHANGES_REQUESTED" ? "Changes Requested" : "Review Required"}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {inProgress.length > 0 && (
                <section className="gl-report-narrative__section">
                    <h2 className="gl-report-narrative__heading">🚧 In Progress ({inProgress.length})</h2>
                    <ul className="gl-report-narrative__list">
                        {inProgress.map(pr => (
                            <li key={pr.id}>
                                <a href={pr.url} target="_blank" rel="noopener noreferrer">#{pr.number}</a>: {pr.title}
                                {pr.authorLogin && <span className="gl-report-narrative__author"> @{pr.authorLogin}</span>}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {blocked.length > 0 && (
                <section className="gl-report-narrative__section gl-report-narrative__section--blockers">
                    <h2 className="gl-report-narrative__heading">🚧 Blockers ({blocked.length})</h2>
                    <ul className="gl-report-narrative__list">
                        {blocked.map(pr => (
                            <li key={pr.id}>
                                <a href={pr.url} target="_blank" rel="noopener noreferrer">#{pr.number}</a>: {pr.title}
                                {pr.authorLogin && <span className="gl-report-narrative__author"> @{pr.authorLogin}</span>}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {merged.length > 0 && (
                <section className="gl-report-narrative__section">
                    <h2 className="gl-report-narrative__heading">🎉 Merged ({merged.length})</h2>
                    <ul className="gl-report-narrative__list">
                        {merged.map(pr => {
                            const team = pr.authorLogin ? getTeamForUser(pr.authorLogin) : undefined
                            return (
                                <li key={pr.id}>
                                    <a href={pr.url} target="_blank" rel="noopener noreferrer">#{pr.number}</a>: {pr.title}
                                    {pr.authorLogin && (
                                        <span className="gl-report-narrative__author">
                                            {" "}@{pr.authorLogin}
                                            {team && <span className="gl-report-narrative__team-dot" style={{ background: TEAM_CSS_COLORS[team.color] }} title={team.name} />}
                                        </span>
                                    )}
                                </li>
                            )
                        })}
                    </ul>
                </section>
            )}

            <section className="gl-report-narrative__section">
                <h2 className="gl-report-narrative__heading">👥 Active Contributors ({contributors.length})</h2>
                <div className="gl-report-narrative__contributors">
                    {contributors.map(login => {
                        const team = getTeamForUser(login)
                        const count = allPrs.filter(pr => pr.authorLogin === login).length
                        return (
                            <span key={login} className="gl-report-narrative__contributor">
                                {team && <span className="gl-report-narrative__team-dot" style={{ background: TEAM_CSS_COLORS[team.color] }} title={team.name} />}
                                @{login} <span className="gl-report-narrative__contributor-count">({count})</span>
                            </span>
                        )
                    })}
                </div>
            </section>
        </div>
    )
}

/** Status badge derived from PR data, not the active tab [BUG-4]. */
function PRStateBadge({ status }: { status: PRStatus }) {
    const label =
        status === "merged" ? "Merged" :
        status === "blocked" ? "Blocked" :
        status === "waiting_for_review" ? "Waiting" :
        status === "reviewed" ? "Reviewed" :
        "Open"
    const cls =
        status === "merged" ? "gl-pr-state--merged" :
        status === "blocked" ? "gl-pr-state--blocked" :
        status === "waiting_for_review" ? "gl-pr-state--waiting" :
        status === "reviewed" ? "gl-pr-state--open" :
        "gl-pr-state--open"
    return <span className={`gl-pr-state ${cls}`}>{label}</span>
}
