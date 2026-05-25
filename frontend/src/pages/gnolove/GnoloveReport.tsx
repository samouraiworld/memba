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

import { useState, useMemo, useCallback, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import {
    addWeeks, addMonths, addYears,
    format, isFuture,
} from "date-fns"
import { useGnoloveReport, useGnoloveRepositories, useReportUrlState } from "../../hooks/gnolove"
import { PageMeta } from "../../components/gnolove/PageMeta"
import { REPORT_TAB_LABELS, TEAMS } from "../../lib/gnoloveConstants"
import type { ReportTab } from "../../lib/gnoloveConstants"
import type { TPullRequest } from "../../lib/gnoloveSchemas"
import { exportToCSV, exportToMarkdown, exportToPDF } from "../../lib/gnoloveExport"
import {
    rangeFromKey, defaultKey, nextAtForPeriodSwitch,
    weekKeyFromDate, monthKeyFromDate, yearKeyFromDate,
    buildShareUrl,
    DEFAULT_REPORT_STATE,
    type ReportPeriod,
} from "../../lib/gnoloveReportUrl"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import { useClickOutside } from "../../hooks/useClickOutside"
import { filterPrs } from "../../lib/gnoloveReportFilters"
import { NarrativeReportView } from "../../components/gnolove/report/NarrativeReportView"
import { EmptyStateMessage } from "../../components/gnolove/report/EmptyStateMessage"
import type { EmptyReason } from "../../components/gnolove/report/types"

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

export default function GnoloveReport() {
    const [urlState, setUrlState] = useReportUrlState()
    const { period, at, tab: activeTab, team: teamOrNull, repos: selectedRepos, view } = urlState
    const selectedTeam = teamOrNull ?? "all"
    const networkKey = useNetworkKey()

    // Ephemeral UI state — stays local (not in URL).
    const [repoDropdownOpen, setRepoDropdownOpen] = useState(false)
    const repoDropdownRef = useRef<HTMLDivElement>(null)
    const [copiedLink, setCopiedLink] = useState(false)

    const closeRepoDropdown = useCallback(() => setRepoDropdownOpen(false), [])
    useClickOutside(repoDropdownRef, closeRepoDropdown)

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

    const filteredPrs = useMemo(
        () => filterPrs(prs, { teamName: selectedTeam, selectedRepos: selectedReposSet, period, start, end, activeTab, report }),
        [prs, selectedTeam, selectedReposSet, period, start, end, activeTab, report],
    )

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

// ── Sub-components ──────────────────────────────────────────────

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
