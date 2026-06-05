/**
 * GnoloveNotablePRs — a Linear-style mirror of the gnolang "Notable PRs by Area"
 * GitHub Project board (#66, https://github.com/orgs/gnolang/projects/66).
 *
 * Purpose: help area leaders find PRs that need review or help, and see who's
 * been asked to review. Two views share the same data + filters:
 *   • List  — dense rows grouped by Area / Status / Repo (default).
 *   • Board — Kanban columns by Status.
 * Defaults to an actionable review-queue (Needs-review ON, Hide-done ON).
 *
 * Data comes from the gnolove backend /projects/notable route (no GitHub auth
 * client-side). Enriched fields: Main Area, requested reviewers, review
 * verdicts, labels, size, author avatar.
 *
 * @module pages/gnolove/GnoloveNotablePRs
 */

import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useNotablePRs } from "../../hooks/gnolove"
import { useNetworkPath } from "../../hooks/useNetworkNav"
import { PageMeta } from "../../components/gnolove/PageMeta"
import type { TNotablePR, TNotablePRLabel } from "../../lib/gnoloveSchemas"

const PROJECT_URL = "https://github.com/orgs/gnolang/projects/66/views/1"

// ── Board taxonomy ───────────────────────────────────────────
const AREA_ORDER = ["VM", "Blockchain", "Gnops", "Gno.land", "UX"] as const
const AREA_COLOR: Record<string, string> = {
    VM: "#00d4aa",
    Blockchain: "#a855f7",
    Gnops: "#ffc107",
    "Gno.land": "#22c55e",
    UX: "#4a9eff",
}
const STATUS_ORDER = ["Todo", "In progress", "Done"] as const
const UNASSIGNED = "Unassigned"

type ViewMode = "list" | "board"
type GroupBy = "area" | "status" | "repo"

// ── Derived state helpers ────────────────────────────────────
type ReviewState = { key: string; label: string; tone: string }

function reviewState(pr: TNotablePR): ReviewState {
    if (pr.state === "MERGED") return { key: "merged", label: "Merged", tone: "var(--gl-color-state-merged, #a855f7)" }
    if (pr.state === "CLOSED") return { key: "closed", label: "Closed", tone: "var(--gl-color-state-closed, #ef4444)" }
    if (pr.isDraft) return { key: "draft", label: "Draft", tone: "#6e7781" }
    switch (pr.reviewDecision) {
        case "APPROVED": return { key: "approved", label: "Approved", tone: "var(--gl-color-state-open, #22c55e)" }
        case "CHANGES_REQUESTED": return { key: "changes", label: "Changes requested", tone: "var(--gl-color-state-waiting, #ffc107)" }
        default: return { key: "review", label: "Review needed", tone: "#ef4444" }
    }
}

/** Open, not draft, not yet approved/merged/closed → still needs reviewer action. */
function needsReview(pr: TNotablePR): boolean {
    return pr.state === "OPEN" && !pr.isDraft && pr.reviewDecision !== "APPROVED"
}

function isDone(pr: TNotablePR): boolean {
    return pr.status === "Done" || pr.state === "MERGED" || pr.state === "CLOSED"
}

function relTime(iso: string): string {
    if (!iso) return ""
    const t = new Date(iso).getTime()
    if (isNaN(t)) return ""
    const s = Math.max(0, (Date.now() - t) / 1000)
    if (s < 3600) return `${Math.floor(s / 60)}m`
    if (s < 86400) return `${Math.floor(s / 3600)}h`
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`
    if (s < 86400 * 365) return `${Math.floor(s / 86400 / 30)}mo`
    return `${Math.floor(s / 86400 / 365)}y`
}

function fmtNum(n: number): string {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k"
    return String(n)
}

/** Strip :shortcode: and unicode emoji from gno label names for a clean chip. */
function cleanLabel(name: string): string {
    const cleaned = name
        .replace(/:[a-z0-9_+-]+:/gi, "")
        .replace(/\p{Extended_Pictographic}/gu, "")
        .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
        .replace(/\s+/g, " ")
        .trim()
    return cleaned || name.trim()
}

function ghAvatar(login: string): string {
    return `https://github.com/${encodeURIComponent(login)}.png?size=40`
}

// ── Small presentational components ──────────────────────────
function Avatar({ login, url, title }: { login: string; url?: string; title?: string }) {
    if (!login) return null
    return (
        <img
            className="gl-np-avatar"
            src={url || ghAvatar(login)}
            alt=""
            title={title ?? login}
            loading="lazy"
            width={18}
            height={18}
        />
    )
}

function LabelChips({ labels }: { labels: TNotablePRLabel[] }) {
    if (!labels.length) return null
    const shown = labels.slice(0, 3)
    const extra = labels.length - shown.length
    return (
        <span className="gl-np-labels">
            {shown.map((l, i) => {
                const text = cleanLabel(l.name)
                const c = /^[0-9a-fA-F]{6}$/.test(l.color) ? `#${l.color}` : "var(--color-border)"
                return (
                    <span key={i} className="gl-np-label" style={{ borderColor: c, color: c }} title={l.name}>
                        {text}
                    </span>
                )
            })}
            {extra > 0 && <span className="gl-np-label gl-np-label--more">+{extra}</span>}
        </span>
    )
}

function Reviewers({ pr }: { pr: TNotablePR }) {
    const reviewed = pr.reviews.filter(r => r.state === "APPROVED" || r.state === "CHANGES_REQUESTED")
    if (!pr.requestedReviewers.length && !reviewed.length) return null
    return (
        <span className="gl-np-reviewers" title="Reviewers">
            {pr.requestedReviewers.length > 0 && (
                <span className="gl-np-rev gl-np-rev--pending" title={`Requested: ${pr.requestedReviewers.join(", ")}`}>
                    <span className="gl-np-rev-glyph">⧗</span>
                    {pr.requestedReviewers.slice(0, 3).map(l => <Avatar key={l} login={l} title={`requested: ${l}`} />)}
                    {pr.requestedReviewers.length > 3 && <span className="gl-np-rev-more">+{pr.requestedReviewers.length - 3}</span>}
                </span>
            )}
            {reviewed.slice(0, 3).map(r => (
                <span
                    key={r.login}
                    className={`gl-np-rev gl-np-rev--${r.state === "APPROVED" ? "ok" : "changes"}`}
                    title={`${r.login}: ${r.state.toLowerCase().replace("_", " ")}`}
                >
                    <span className="gl-np-rev-glyph">{r.state === "APPROVED" ? "✓" : "✕"}</span>
                    <Avatar login={r.login} title={r.login} />
                </span>
            ))}
        </span>
    )
}

function PRRow({ pr }: { pr: TNotablePR }) {
    const rs = reviewState(pr)
    return (
        <a href={pr.url} target="_blank" rel="noopener noreferrer" className="gl-np-row">
            <span className="gl-np-dot" style={{ background: rs.tone }} title={rs.label} />
            <span className="gl-np-main">
                <span className="gl-np-title">{pr.title}</span>
                <span className="gl-np-sub">
                    <Avatar login={pr.authorLogin} url={pr.authorAvatarUrl} title={pr.authorLogin} />
                    <span className="gl-np-repo">{pr.repository}#{pr.number}</span>
                    {pr.mainArea && (
                        <span className="gl-np-area" style={{ color: AREA_COLOR[pr.mainArea] }}>● {pr.mainArea}</span>
                    )}
                    <LabelChips labels={pr.labels} />
                </span>
            </span>
            <span className="gl-np-right">
                <Reviewers pr={pr} />
                {(pr.additions > 0 || pr.deletions > 0) && (
                    <span className="gl-np-size">
                        <span className="gl-np-add">+{fmtNum(pr.additions)}</span>{" "}
                        <span className="gl-np-del">−{fmtNum(pr.deletions)}</span>
                    </span>
                )}
                <span className="gl-np-statelabel" style={{ color: rs.tone }}>{rs.label}</span>
                <span className="gl-np-time">{relTime(pr.updatedAt)}</span>
            </span>
        </a>
    )
}

function PRCard({ pr }: { pr: TNotablePR }) {
    const rs = reviewState(pr)
    return (
        <a href={pr.url} target="_blank" rel="noopener noreferrer" className="gl-np-card" style={{ borderTopColor: rs.tone }}>
            <span className="gl-np-card-title">{pr.title}</span>
            <span className="gl-np-sub">
                <Avatar login={pr.authorLogin} url={pr.authorAvatarUrl} title={pr.authorLogin} />
                <span className="gl-np-repo">{pr.repository}#{pr.number}</span>
                {pr.mainArea && <span className="gl-np-area" style={{ color: AREA_COLOR[pr.mainArea] }}>● {pr.mainArea}</span>}
            </span>
            <LabelChips labels={pr.labels} />
            <span className="gl-np-card-foot">
                <Reviewers pr={pr} />
                {(pr.additions > 0 || pr.deletions > 0) && (
                    <span className="gl-np-size"><span className="gl-np-add">+{fmtNum(pr.additions)}</span> <span className="gl-np-del">−{fmtNum(pr.deletions)}</span></span>
                )}
            </span>
        </a>
    )
}

// ── Grouping ─────────────────────────────────────────────────
function groupKey(pr: TNotablePR, by: GroupBy): string {
    if (by === "area") return pr.mainArea || UNASSIGNED
    if (by === "status") return pr.status || UNASSIGNED
    return pr.repository || UNASSIGNED
}

function orderedGroups(map: Map<string, TNotablePR[]>, by: GroupBy): string[] {
    const keys = Array.from(map.keys())
    const order = by === "area" ? AREA_ORDER : by === "status" ? STATUS_ORDER : []
    const rank = (k: string): number => {
        const i = (order as readonly string[]).indexOf(k)
        return i === -1 ? (k === UNASSIGNED ? 9998 : 9000 + keys.indexOf(k)) : i
    }
    return keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** Within a group: needs-review first, then most-recently updated. */
function sortRows(prs: TNotablePR[]): TNotablePR[] {
    return [...prs].sort((a, b) => {
        const na = needsReview(a) ? 0 : 1
        const nb = needsReview(b) ? 0 : 1
        if (na !== nb) return na - nb
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })
}

// ── Page ─────────────────────────────────────────────────────
export default function GnoloveNotablePRs() {
    const np = useNetworkPath()
    const { data, isLoading, isError } = useNotablePRs()

    const [view, setView] = useState<ViewMode>("list")
    const [groupBy, setGroupBy] = useState<GroupBy>("area")
    const [area, setArea] = useState<string>("all")
    const [needsReviewOnly, setNeedsReviewOnly] = useState(true)
    const [hideDone, setHideDone] = useState(true)
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

    const all = useMemo(() => data ?? [], [data])

    // Areas present (for the filter chips), in canonical order.
    const areas = useMemo(() => {
        const present = new Set(all.map(p => p.mainArea).filter(Boolean))
        return AREA_ORDER.filter(a => present.has(a))
    }, [all])

    const filtered = useMemo(() => all.filter(pr => {
        if (area !== "all" && pr.mainArea !== area) return false
        if (needsReviewOnly && !needsReview(pr)) return false
        if (hideDone && isDone(pr)) return false
        return true
    }), [all, area, needsReviewOnly, hideDone])

    const groups = useMemo(() => {
        const m = new Map<string, TNotablePR[]>()
        for (const pr of filtered) {
            const k = groupKey(pr, groupBy)
            const arr = m.get(k)
            if (arr) arr.push(pr); else m.set(k, [pr])
        }
        return orderedGroups(m, groupBy).map(k => ({ key: k, prs: sortRows(m.get(k)!) }))
    }, [filtered, groupBy])

    const toggleGroup = (k: string) => setCollapsed(prev => {
        const next = new Set(prev)
        if (next.has(k)) next.delete(k); else next.add(k)
        return next
    })

    return (
        <div className="gl-page">
            <PageMeta title="Notable PRs | Gnolove · Memba" description="PRs from the gnolang Notable PRs board that need review or help." />
            <Link to={np("gnolove")} className="gl-profile-back">← Back to Contributors Overview</Link>

            <div className="gl-header">
                <h1 className="gl-title">Notable PRs</h1>
                <a href={PROJECT_URL} target="_blank" rel="noopener noreferrer" className="gl-thub-chip" title="Open the gnolang Notable PRs board on GitHub">
                    gnolang/projects #66 ↗
                </a>
            </div>
            <p className="gl-team-profile-desc" style={{ marginTop: 0 }}>
                PRs the Gno core team flagged as needing review or help, mirrored from the{" "}
                <a href={PROJECT_URL} target="_blank" rel="noopener noreferrer">Notable PRs by Area</a> board.
            </p>

            {/* ── Controls ── */}
            <div className="gl-np-controls">
                <div className="gl-np-seg" role="tablist" aria-label="View">
                    <button className={`gl-np-seg-btn${view === "list" ? " is-active" : ""}`} onClick={() => setView("list")}>☰ List</button>
                    <button className={`gl-np-seg-btn${view === "board" ? " is-active" : ""}`} onClick={() => setView("board")}>▤ Board</button>
                </div>

                {view === "list" && (
                    <label className="gl-np-group">
                        Group by
                        <select value={groupBy} onChange={e => setGroupBy(e.target.value as GroupBy)} className="gl-np-select">
                            <option value="area">Area</option>
                            <option value="status">Status</option>
                            <option value="repo">Repository</option>
                        </select>
                    </label>
                )}

                <div className="gl-np-areas">
                    <button className={`gl-np-chip${area === "all" ? " is-active" : ""}`} onClick={() => setArea("all")}>All areas</button>
                    {areas.map(a => (
                        <button key={a} className={`gl-np-chip${area === a ? " is-active" : ""}`} onClick={() => setArea(a)}
                            style={area === a ? { borderColor: AREA_COLOR[a], color: AREA_COLOR[a] } : undefined}>
                            {a}
                        </button>
                    ))}
                </div>

                <label className="gl-np-toggle">
                    <input type="checkbox" checked={needsReviewOnly} onChange={e => setNeedsReviewOnly(e.target.checked)} /> Needs review
                </label>
                <label className="gl-np-toggle">
                    <input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} /> Hide done
                </label>
                <span className="gl-np-count">{filtered.length} PR{filtered.length === 1 ? "" : "s"}</span>
            </div>

            {/* ── States ── */}
            {isLoading && <p className="gl-team-profile-desc">Loading notable PRs…</p>}
            {isError && <p className="gl-team-profile-desc" role="alert">Couldn't load the notable PRs board right now. Please try again later.</p>}
            {!isLoading && !isError && all.length === 0 && (
                <p className="gl-team-profile-desc">
                    No notable PRs to show yet. View the board{" "}
                    <a href={PROJECT_URL} target="_blank" rel="noopener noreferrer">directly on GitHub</a>.
                </p>
            )}
            {!isLoading && !isError && all.length > 0 && filtered.length === 0 && (
                <p className="gl-team-profile-desc">No PRs match the current filters. Try turning off “Needs review” or “Hide done”.</p>
            )}

            {/* ── List view ── */}
            {view === "list" && groups.map(({ key, prs }) => {
                const isCollapsed = collapsed.has(key)
                const color = groupBy === "area" ? AREA_COLOR[key] : undefined
                return (
                    <section key={key} className="gl-np-group-section">
                        <button className="gl-np-group-head" onClick={() => toggleGroup(key)} aria-expanded={!isCollapsed}>
                            <span className="gl-np-caret">{isCollapsed ? "▸" : "▾"}</span>
                            <span className="gl-np-group-name" style={color ? { color } : undefined}>{key}</span>
                            <span className="gl-np-group-count">{prs.length}</span>
                        </button>
                        {!isCollapsed && <div className="gl-np-rows">{prs.map(pr => <PRRow key={pr.itemID} pr={pr} />)}</div>}
                    </section>
                )
            })}

            {/* ── Board view ── */}
            {view === "board" && filtered.length > 0 && (
                <div className="gl-np-board">
                    {STATUS_ORDER.map(st => {
                        const col = sortRows(filtered.filter(p => (p.status || UNASSIGNED) === st))
                        return (
                            <div key={st} className="gl-np-col">
                                <div className="gl-np-col-head">{st}<span className="gl-np-group-count">{col.length}</span></div>
                                <div className="gl-np-col-body">
                                    {col.map(pr => <PRCard key={pr.itemID} pr={pr} />)}
                                    {col.length === 0 && <div className="gl-np-col-empty">—</div>}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
