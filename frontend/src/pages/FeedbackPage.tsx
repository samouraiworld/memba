/**
 * FeedbackPage — Feedback & Feature Requests hub.
 *
 * GitHub issues for bugs and ideas, plus the feedback realm where deployed.
 *
 * @module pages/FeedbackPage
 */

import { useState, useEffect, useRef } from "react"
import { FeedbackFeed } from "../components/FeedbackFeed"
import { isFeedbackValid } from "../lib/config"
import { trackPageVisit } from "../lib/quests"
import { useWindowActive } from "../os/page/WindowActivity"
import "./feedback.css"

const GITHUB_REPO = "samouraiworld/Memba"
const GITHUB_ISSUES_URL = `https://github.com/${GITHUB_REPO}/issues`
const GITHUB_NEW_ISSUE = `${GITHUB_ISSUES_URL}/new/choose`
const FEEDBACK_LABELS = new Set(["bug", "enhancement", "feedback"])
const issueSearch = new URL("https://api.github.com/search/issues")
issueSearch.searchParams.set("q", `repo:${GITHUB_REPO} is:issue is:open label:bug,enhancement,feedback`)
issueSearch.searchParams.set("sort", "created")
issueSearch.searchParams.set("order", "desc")
issueSearch.searchParams.set("per_page", "15")

interface GitHubIssue {
    id: number
    number: number
    title: string
    state: string
    pull_request?: unknown
    comments: number
    created_at: string
    labels: { name: string; color: string }[]
    user: { login: string } | null
}

export default function FeedbackPage() {
    const windowActive = useWindowActive()
    const realmAvailable = isFeedbackValid()
    const [issues, setIssues] = useState<GitHubIssue[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)
    const [issueRetry, setIssueRetry] = useState(0)
    const visited = useRef(false)
    const loadedIssues = useRef(false)

    useEffect(() => {
        if (!windowActive) return
        const previousTitle = document.title
        const title = "Feedback — Memba"
        document.title = title
        return () => { if (document.title === title) document.title = previousTitle }
    }, [windowActive])

    useEffect(() => {
        if (!windowActive || loadedIssues.current) return
        loadedIssues.current = true
        if (!visited.current) {
            trackPageVisit("feedback")
            visited.current = true
        }
        const controller = new AbortController()
        let completed = false

        fetch(issueSearch.toString(), {
            headers: { Accept: "application/vnd.github.v3+json" },
            signal: controller.signal,
        })
            .then(res => {
                if (!res.ok) throw new Error("GitHub API error")
                return res.json() as Promise<{ items: GitHubIssue[] }>
            })
            .then(data => {
                if (!Array.isArray(data.items)) throw new Error("Invalid GitHub response")
                if (!controller.signal.aborted) setIssues(data.items.filter(issue =>
                    !issue.pull_request && issue.state === "open" &&
                    Array.isArray(issue.labels) && issue.labels.some(label => FEEDBACK_LABELS.has(label.name.toLowerCase()))
                ))
            })
            .catch(() => { if (!controller.signal.aborted) setError(true) })
            .finally(() => {
                completed = true
                if (!controller.signal.aborted) setLoading(false)
            })
        return () => {
            controller.abort()
            // A window may become inactive before the request finishes.
            // Let the next activation load its issue list.
            if (!completed) loadedIssues.current = false
        }
    }, [windowActive, issueRetry])

    const formatDate = (iso: string) => {
        const d = new Date(iso)
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    }

    return (
        <div id="feedback-page" className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 720 }}>
            {/* Header */}
            <div>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--color-text)", margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                    <span>📣</span> Feedback & Feature Requests
                </h1>
                <p style={{ fontSize: "var(--pro-small, 12px)", color: "var(--color-text-secondary)", marginTop: 8, lineHeight: 1.6, fontFamily: "var(--font-ui, JetBrains Mono, monospace)" }}>
                    Help shape Memba's future. Report bugs, suggest features, or review community ideas.
                </p>
            </div>

            {/* Submit Feedback CTA */}
            <div className="feedback-submit-card" style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "14px 20px",
                borderRadius: 10,
                background: "rgba(0, 212, 170, 0.04)",
                border: "1px solid rgba(0, 212, 170, 0.12)",
            }}>
                <div className="feedback-submit-copy" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: "var(--pro-small, 13px)", fontWeight: 600, color: "var(--color-text)" }}>Have an idea or found a bug?</span>
                    <span style={{ fontSize: "var(--pro-caption, 10px)", color: "var(--color-text-muted)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)" }}>
                        Open a GitHub issue to report a bug or suggest an improvement. A GitHub account is required.
                    </span>
                </div>
                <a
                    href={GITHUB_NEW_ISSUE}
                    target="_blank"
                    rel="noopener noreferrer"
                    id="feedback-submit-btn"
                    className="feedback-submit-action"
                    style={{
                        padding: "8px 16px", borderRadius: 6, fontSize: "var(--pro-small, 12px)", fontWeight: 600,
                        background: "var(--color-brand)", color: "var(--color-text-contrast)", textDecoration: "none",
                        fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
                        transition: "opacity 0.15s",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
                    onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                >
                    + Submit Feedback
                </a>
            </div>

            {/* GitHub Issues */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="feedback-issues-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <h2 style={{ fontSize: "var(--pro-body, 14px)", fontWeight: 600, color: "var(--color-text)", margin: 0 }}>
                        Open feedback issues
                    </h2>
                    <a
                        href={GITHUB_ISSUES_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            fontSize: "var(--pro-caption, 10px)", color: "var(--color-primary)", textDecoration: "none",
                            fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
                        }}
                    >
                        View all on GitHub →
                    </a>
                </div>

                {loading ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {[1, 2, 3].map(i => (
                            <div key={i} className="k-shimmer" style={{ height: 52, borderRadius: 8, background: "var(--color-border)" }} />
                        ))}
                    </div>
                ) : error ? (
                    <div role="alert" className="feedback-issues-error" style={{
                        padding: "16px 20px", borderRadius: 10,
                        background: "rgba(255, 59, 48, 0.03)",
                        border: "1px solid rgba(255, 59, 48, 0.1)",
                        fontSize: "var(--pro-small, 12px)", color: "var(--color-text-secondary)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
                    }}>
                        ⚠ Could not load GitHub issues. <a
                            href={GITHUB_ISSUES_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "var(--color-primary)" }}
                        >View directly on GitHub →</a>
                        <button
                            type="button"
                            className="feedback-retry"
                            style={{ display: "block", marginTop: 12 }}
                            onClick={() => {
                                loadedIssues.current = false
                                setLoading(true)
                                setError(false)
                                setIssueRetry(n => n + 1)
                            }}
                        >Retry</button>
                    </div>
                ) : issues.length === 0 ? (
                    <div style={{
                        padding: "24px", textAlign: "center", borderRadius: 10,
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        fontSize: "var(--pro-small, 12px)", color: "var(--color-text-secondary)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
                    }}>
                        No open feedback issues right now. Share a bug or idea through GitHub.
                    </div>
                ) : (
                    issues.map(issue => (
                        <a
                            key={issue.id}
                            href={`${GITHUB_ISSUES_URL}/${issue.number}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="feedback-issue"
                            style={{
                                display: "flex", alignItems: "flex-start", gap: 12,
                                padding: "12px 16px",
                                borderRadius: 8,
                                background: "rgba(255,255,255,0.02)",
                                border: "1px solid rgba(255,255,255,0.06)",
                                textDecoration: "none",
                                transition: "border-color 0.15s, background 0.15s",
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.borderColor = "rgba(0, 212, 170, 0.2)"
                                e.currentTarget.style.background = "rgba(255,255,255,0.03)"
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"
                                e.currentTarget.style.background = "rgba(255,255,255,0.02)"
                            }}
                        >
                            <span style={{
                                fontSize: "var(--pro-caption, 10px)", color: "var(--color-text-muted)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
                                minWidth: 30, textAlign: "right", paddingTop: 2,
                            }} className="feedback-issue-number">
                                #{issue.number}
                            </span>
                            <div className="feedback-issue-body" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                <span className="feedback-issue-title" style={{ fontSize: "var(--pro-small, 13px)", fontWeight: 600, color: "var(--color-text)", lineHeight: 1.3 }}>
                                    {issue.title}
                                </span>
                                <div className="feedback-issue-meta" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                    {issue.labels.map(label => {
                                        const tint = /^[0-9a-fA-F]{6}$/.test(label.color) ? label.color : "6B7280"
                                        return (
                                            <span key={label.name} style={{
                                                fontSize: "var(--pro-caption, 9px)", padding: "1px 6px", borderRadius: 3,
                                                background: `#${tint}22`,
                                                color: "var(--color-text)",
                                                fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
                                            }}>
                                                {label.name}
                                            </span>
                                        )
                                    })}
                                    <span style={{ fontSize: "var(--pro-caption, 10px)", color: "var(--color-text-dim)", fontFamily: "var(--font-ui, JetBrains Mono, monospace)" }}>
                                        by {issue.user?.login ?? "a former contributor"} · {formatDate(issue.created_at)}
                                        {issue.comments > 0 && ` · ${issue.comments} comment${issue.comments !== 1 ? "s" : ""}`}
                                    </span>
                                </div>
                            </div>
                        </a>
                    ))
                )}
            </div>

            {!realmAvailable && /* This network has no feedback realm yet. */
            <div style={{
                padding: "16px 20px", borderRadius: 10,
                background: "rgba(124, 58, 237, 0.03)",
                border: "1px solid rgba(124, 58, 237, 0.1)",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{
                        fontSize: "var(--pro-caption, 9px)", padding: "2px 6px", borderRadius: 3,
                        background: "rgba(124, 58, 237, 0.1)", color: "var(--color-k-purple-text)",
                        fontWeight: 700, letterSpacing: "0.05em",
                        fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
                    }}>NOT AVAILABLE HERE YET</span>
                    <span style={{ fontSize: "var(--pro-small, 13px)", fontWeight: 600, color: "var(--color-text)" }}>
                        🔮 On-Chain Feedback Board
                    </span>
                </div>
                <p style={{
                    fontSize: "var(--pro-caption, 11px)", color: "var(--color-text-secondary)", margin: 0, lineHeight: 1.6,
                    fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
                }}>
                    On-chain feedback is not available on this network yet. Use the GitHub issue form above to share a bug or idea.
                </p>
            </div>}

            {/* FeedbackFeed distinguishes an empty live board from a failed realm read. */}
            {realmAvailable && <FeedbackFeed />}
        </div>
    )
}
