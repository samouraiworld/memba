/**
 * FeedbackPage — Feedback & Feature Requests hub.
 *
 * Dual-track approach (v2.10):
 * - Now: GitHub Issues integration (public repo, no auth needed)
 * - Later: On-chain feedback realm on betanet
 *
 * Fetches open issues labeled "feedback" from the Memba GitHub repo.
 *
 * @module pages/FeedbackPage
 */

import { useState, useEffect } from "react"
import { FeedbackFeed } from "../components/FeedbackFeed"
import { completeQuest, trackPageVisit } from "../lib/quests"

const GITHUB_REPO = "samouraiworld/Memba"
const GITHUB_ISSUES_URL = `https://api.github.com/repos/${GITHUB_REPO}/issues`
const GITHUB_NEW_ISSUE = `https://github.com/${GITHUB_REPO}/issues/new?template=feedback.md&title=%5BFeedback%5D+`

interface GitHubIssue {
    id: number
    number: number
    title: string
    html_url: string
    comments: number
    created_at: string
    labels: { name: string; color: string }[]
    user: { login: string; avatar_url: string }
}

export default function FeedbackPage() {
    const [issues, setIssues] = useState<GitHubIssue[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)

    useEffect(() => {
        document.title = "Feedback — Memba"
        trackPageVisit("feedback")

        fetch(`${GITHUB_ISSUES_URL}?state=open&per_page=15&sort=created&direction=desc`, {
            headers: { Accept: "application/vnd.github.v3+json" },
        })
            .then(res => {
                if (!res.ok) throw new Error("GitHub API error")
                return res.json()
            })
            .then((data: GitHubIssue[]) => setIssues(data))
            .catch(() => setError(true))
            .finally(() => setLoading(false))
    }, [])

    const formatDate = (iso: string) => {
        const d = new Date(iso)
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    }

    return (
        <div id="feedback-page" className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 720 }}>
            {/* Header */}
            <div>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: "#f0f0f0", margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                    <span>📣</span> Feedback & Feature Requests
                </h1>
                <p style={{ fontSize: 12, color: "#666", marginTop: 8, lineHeight: 1.6, fontFamily: "JetBrains Mono, monospace" }}>
                    Help shape Memba's future. Report bugs, suggest features, or vote on community ideas.
                </p>
            </div>

            {/* Submit Feedback CTA */}
            <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "14px 20px", borderRadius: 10,
                background: "rgba(0, 212, 170, 0.04)",
                border: "1px solid rgba(0, 212, 170, 0.12)",
            }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f0" }}>Have an idea or found a bug?</span>
                    <span style={{ fontSize: 10, color: "#555", fontFamily: "JetBrains Mono, monospace" }}>
                        Open a GitHub issue — we review every submission.
                    </span>
                </div>
                <a
                    href={GITHUB_NEW_ISSUE}
                    target="_blank"
                    rel="noopener noreferrer"
                    id="feedback-submit-btn"
                    onClick={() => completeQuest("submit-feedback")}
                    style={{
                        padding: "8px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                        background: "#00d4aa", color: "#000", textDecoration: "none",
                        fontFamily: "JetBrains Mono, monospace",
                        transition: "opacity 0.15s",
                        whiteSpace: "nowrap",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
                    onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                >
                    + Submit Feedback
                </a>
            </div>

            {/* GitHub Issues */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <h2 style={{ fontSize: 14, fontWeight: 600, color: "#e0e0e0", margin: 0 }}>
                        Open Issues
                    </h2>
                    <a
                        href={`https://github.com/${GITHUB_REPO}/issues`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            fontSize: 10, color: "#00d4aa", textDecoration: "none",
                            fontFamily: "JetBrains Mono, monospace",
                        }}
                    >
                        View all on GitHub →
                    </a>
                </div>

                {loading ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {[1, 2, 3].map(i => (
                            <div key={i} className="k-shimmer" style={{ height: 52, borderRadius: 8, background: "#111" }} />
                        ))}
                    </div>
                ) : error ? (
                    <div style={{
                        padding: "16px 20px", borderRadius: 10,
                        background: "rgba(255, 59, 48, 0.03)",
                        border: "1px solid rgba(255, 59, 48, 0.1)",
                        fontSize: 12, color: "#888", fontFamily: "JetBrains Mono, monospace",
                    }}>
                        ⚠ Could not load GitHub issues. <a
                            href={`https://github.com/${GITHUB_REPO}/issues`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "#00d4aa" }}
                        >View directly on GitHub →</a>
                    </div>
                ) : issues.length === 0 ? (
                    <div style={{
                        padding: "24px", textAlign: "center", borderRadius: 10,
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        fontSize: 12, color: "#666", fontFamily: "JetBrains Mono, monospace",
                    }}>
                        No open issues. Be the first to submit feedback!
                    </div>
                ) : (
                    issues.map(issue => (
                        <a
                            key={issue.id}
                            href={issue.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                                display: "flex", alignItems: "flex-start", gap: 12,
                                padding: "12px 16px", borderRadius: 8,
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
                                fontSize: 10, color: "#555", fontFamily: "JetBrains Mono, monospace",
                                minWidth: 30, textAlign: "right", paddingTop: 2,
                            }}>
                                #{issue.number}
                            </span>
                            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f0", lineHeight: 1.3 }}>
                                    {issue.title}
                                </span>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                    {issue.labels.map(label => (
                                        <span key={label.name} style={{
                                            fontSize: 9, padding: "1px 6px", borderRadius: 3,
                                            background: `#${label.color}22`,
                                            color: `#${label.color}`,
                                            fontFamily: "JetBrains Mono, monospace",
                                        }}>
                                            {label.name}
                                        </span>
                                    ))}
                                    <span style={{ fontSize: 10, color: "#444", fontFamily: "JetBrains Mono, monospace" }}>
                                        by {issue.user.login} · {formatDate(issue.created_at)}
                                        {issue.comments > 0 && ` · ${issue.comments} comment${issue.comments !== 1 ? "s" : ""}`}
                                    </span>
                                </div>
                            </div>
                        </a>
                    ))
                )}
            </div>

            {/* On-chain Feedback — Future */}
            <div style={{
                padding: "16px 20px", borderRadius: 10,
                background: "rgba(124, 58, 237, 0.03)",
                border: "1px solid rgba(124, 58, 237, 0.1)",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{
                        fontSize: 9, padding: "2px 6px", borderRadius: 3,
                        background: "rgba(124, 58, 237, 0.1)", color: "#7c3aed",
                        fontWeight: 700, letterSpacing: "0.05em",
                        fontFamily: "JetBrains Mono, monospace",
                    }}>COMING ON BETANET</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#e0e0e0" }}>
                        🔮 On-Chain Feedback Board
                    </span>
                </div>
                <p style={{
                    fontSize: 11, color: "#666", margin: 0, lineHeight: 1.6,
                    fontFamily: "JetBrains Mono, monospace",
                }}>
                    A sovereign, on-chain feedback realm will be deployed on betanet, allowing fully decentralized feature voting and bug reporting directly from Memba.
                </p>
            </div>

            {/* FeedbackFeed — on-chain (shows "not deployed yet" gracefully) */}
            <FeedbackFeed />
        </div>
    )
}
