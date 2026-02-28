import { useState, useEffect, useCallback } from "react"
import { useParams, useNavigate, useOutletContext } from "react-router-dom"
import { ErrorToast } from "../components/ui/ErrorToast"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { GNOLOVE_API_URL, getExplorerBaseUrl } from "../lib/config"
import { fetchUserProfile, type UserProfile } from "../lib/profile"
import type { LayoutContext } from "../types/layout"

export function ProfilePage() {
    const { address } = useParams<{ address: string }>()
    const navigate = useNavigate()
    const { adena } = useOutletContext<LayoutContext>()

    const [profile, setProfile] = useState<UserProfile | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const isOwnProfile = adena.address === address

    const loadProfile = useCallback(async () => {
        if (!address) return
        setLoading(true)
        setError(null)
        try {
            const p = await fetchUserProfile(GNOLOVE_API_URL, address)
            setProfile(p)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load profile")
        } finally {
            setLoading(false)
        }
    }, [address])

    useEffect(() => { loadProfile() }, [loadProfile])

    if (!address) {
        return (
            <div className="animate-fade-in" style={{ textAlign: "center", padding: 48 }}>
                <p style={{ color: "#666", fontSize: 14, fontFamily: "JetBrains Mono, monospace" }}>
                    No address specified
                </p>
            </div>
        )
    }

    if (loading) {
        return (
            <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                <SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
        )
    }

    const avatar = profile?.githubAvatar || profile?.avatarUrl || ""
    const displayName = profile?.username || `${address.slice(0, 10)}...${address.slice(-4)}`
    const explorerUrl = getExplorerBaseUrl()

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Back nav */}
            <button
                id="profile-back-btn"
                aria-label="Go back"
                onClick={() => navigate(-1)}
                style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace", textAlign: "left" }}
            >
                ← Back
            </button>

            {/* ── Profile Header Card ─────────────────────────────── */}
            <div className="k-card" style={{ padding: "28px 24px", position: "relative", overflow: "hidden" }}>
                {/* Gradient accent */}
                <div style={{
                    position: "absolute", top: 0, left: 0, right: 0, height: 4,
                    background: "linear-gradient(90deg, #00d4aa, #2196f3, #7b61ff)",
                }} />

                <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                    {/* Avatar */}
                    <div style={{
                        width: 72, height: 72, borderRadius: "50%",
                        background: avatar ? `url(${avatar}) center/cover` : "rgba(0,212,170,0.08)",
                        border: "2px solid rgba(0,212,170,0.2)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                    }}>
                        {!avatar && (
                            <span style={{ fontSize: 28, color: "#00d4aa" }}>👤</span>
                        )}
                    </div>

                    {/* Identity */}
                    <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: "#f0f0f0" }}>
                                {displayName}
                            </h2>
                            {isOwnProfile && (
                                <span style={{
                                    padding: "2px 8px", borderRadius: 4, fontSize: 9,
                                    fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                    background: "rgba(0,212,170,0.1)", color: "#00d4aa",
                                }}>
                                    YOU
                                </span>
                            )}
                        </div>

                        <div style={{ marginTop: 6 }}>
                            <CopyableAddress address={address} />
                        </div>

                        {/* Username CTA if own profile and no username */}
                        {isOwnProfile && !profile?.username && (
                            <a
                                href={`${explorerUrl}/r/gnoland/users/v1`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                    display: "inline-flex", alignItems: "center", gap: 6,
                                    marginTop: 10, padding: "6px 14px", borderRadius: 6,
                                    fontSize: 11, fontFamily: "JetBrains Mono, monospace",
                                    background: "rgba(0,212,170,0.06)", border: "1px dashed rgba(0,212,170,0.2)",
                                    color: "#00d4aa", textDecoration: "none",
                                }}
                            >
                                🏷️ Register your @username →
                            </a>
                        )}

                        {/* Bio */}
                        {(profile?.bio || profile?.githubBio) && (
                            <p style={{ color: "#888", fontSize: 13, fontFamily: "JetBrains Mono, monospace", marginTop: 10, maxWidth: 500 }}>
                                {profile.bio || profile.githubBio}
                            </p>
                        )}
                    </div>
                </div>

                {/* Meta: company, title, location */}
                <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
                    {profile?.company && (
                        <MetaChip icon="🏢" text={profile.company} />
                    )}
                    {profile?.title && (
                        <MetaChip icon="💼" text={profile.title} />
                    )}
                    {profile?.githubLocation && (
                        <MetaChip icon="📍" text={profile.githubLocation} />
                    )}
                </div>
            </div>

            {/* ── Social Links ─────────────────────────────────────── */}
            {hasSocials(profile) && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {profile?.socialLinks.github && (
                        <SocialLink href={profile.socialLinks.github} icon="🐙" label="GitHub" />
                    )}
                    {profile?.socialLinks.twitter && (
                        <SocialLink href={`https://x.com/${profile.socialLinks.twitter}`} icon="𝕏" label="Twitter/X" />
                    )}
                    {profile?.socialLinks.website && (
                        <SocialLink href={profile.socialLinks.website} icon="🌐" label="Website" />
                    )}
                    {profile?.username && (
                        <SocialLink href={profile.userRealmUrl} icon="⛓" label="gno.land" />
                    )}
                </div>
            )}

            {/* ── Gnolove Contribution Stats ───────────────────────── */}
            {profile && profile.lovePowerScore > 0 && (
                <div className="k-card" style={{ padding: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                        <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0" }}>
                            ❤️ Gno Contributions
                        </h3>
                        <a
                            href="https://gnolove.world"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 10, color: "#00d4aa", fontFamily: "JetBrains Mono, monospace", textDecoration: "none" }}
                        >
                            gnolove.world →
                        </a>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
                        <ContribStat label="Love Power" value={String(profile.lovePowerScore)} icon="💜" accent />
                        <ContribStat label="Commits" value={String(profile.totalCommits)} icon="📝" />
                        <ContribStat label="Pull Requests" value={String(profile.totalPRs)} icon="🔀" />
                        <ContribStat label="Issues" value={String(profile.totalIssues)} icon="🐛" />
                        <ContribStat label="Reviews" value={String(profile.totalReviews)} icon="👁" />
                    </div>

                    {/* Score formula note */}
                    <div style={{ marginTop: 12, fontSize: 9, color: "#444", fontFamily: "JetBrains Mono, monospace" }}>
                        Score = commits×10 + PRs×2 + issues×0.5 + reviews×2
                    </div>
                </div>
            )}

            {/* ── Deployed Packages/Realms ──────────────────────────── */}
            {profile && profile.deployedPackages.length > 0 && (
                <div className="k-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", marginBottom: 14 }}>
                        📦 Deployed Packages ({profile.deployedPackages.length})
                    </h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {profile.deployedPackages.slice(0, 20).map((pkg) => (
                            <a
                                key={pkg.path}
                                href={`${explorerUrl}/${pkg.path}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="k-card"
                                style={{
                                    padding: "10px 14px", textDecoration: "none",
                                    display: "flex", justifyContent: "space-between", alignItems: "center",
                                    transition: "border-color 0.15s",
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#333")}
                                onMouseLeave={(e) => (e.currentTarget.style.borderColor = "")}
                            >
                                <span style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "#00d4aa", wordBreak: "break-all" }}>
                                    {pkg.path}
                                </span>
                                <span style={{ fontSize: 9, color: "#555", fontFamily: "JetBrains Mono, monospace", whiteSpace: "nowrap", marginLeft: 10 }}>
                                    Block #{pkg.blockHeight}
                                </span>
                            </a>
                        ))}
                        {profile.deployedPackages.length > 20 && (
                            <div style={{ fontSize: 11, color: "#555", fontFamily: "JetBrains Mono, monospace", textAlign: "center", padding: 8 }}>
                                +{profile.deployedPackages.length - 20} more
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Governance Votes ──────────────────────────────────── */}
            {profile && profile.governanceVotes.length > 0 && (
                <div className="k-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", marginBottom: 14 }}>
                        🗳️ Governance Votes ({profile.governanceVotes.length})
                    </h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {profile.governanceVotes.slice(0, 20).map((v, i) => {
                            const voteColor = v.vote === "YES" ? "#4caf50" : v.vote === "NO" ? "#f44336" : "#888"
                            return (
                                <div key={i} className="k-card" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div>
                                        <span style={{ fontSize: 10, color: "#555", fontFamily: "JetBrains Mono, monospace" }}>
                                            Prop #{v.proposalId}
                                        </span>
                                        <span style={{ fontSize: 12, color: "#ccc", marginLeft: 8 }}>
                                            {v.proposalTitle}
                                        </span>
                                    </div>
                                    <span style={{
                                        padding: "2px 8px", borderRadius: 4, fontSize: 9,
                                        fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                        background: `${voteColor}15`, color: voteColor,
                                    }}>
                                        {v.vote}
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* ── Empty State ───────────────────────────────────────── */}
            {profile && !profile.username && !profile.githubLogin && profile.deployedPackages.length === 0 && profile.governanceVotes.length === 0 && (
                <div className="k-dashed" style={{ background: "#0c0c0c", padding: 48, textAlign: "center" }}>
                    <div style={{ width: 56, height: 56, borderRadius: 14, background: "rgba(0,212,170,0.06)", border: "1px dashed rgba(0,212,170,0.3)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                        <span style={{ fontSize: 28 }}>👤</span>
                    </div>
                    <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>No profile data yet</h3>
                    <p style={{ color: "#666", fontSize: 12, maxWidth: 360, margin: "0 auto", fontFamily: "JetBrains Mono, monospace" }}>
                        This address has no registered username, GitHub activity, or on-chain deployments.
                    </p>
                </div>
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

// ── Sub-Components ───────────────────────────────────────────

function MetaChip({ icon, text }: { icon: string; text: string }) {
    return (
        <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "4px 10px", borderRadius: 6, fontSize: 11,
            fontFamily: "JetBrains Mono, monospace",
            background: "rgba(255,255,255,0.03)", color: "#888",
        }}>
            {icon} {text}
        </span>
    )
}

function SocialLink({ href, icon, label }: { href: string; icon: string; label: string }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 8,
                background: "rgba(255,255,255,0.03)", border: "1px solid #1a1a1a",
                color: "#aaa", fontSize: 12, fontFamily: "JetBrains Mono, monospace",
                textDecoration: "none", transition: "border-color 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#333"; e.currentTarget.style.color = "#f0f0f0" }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1a1a1a"; e.currentTarget.style.color = "#aaa" }}
        >
            <span style={{ fontSize: 14 }}>{icon}</span>
            {label}
        </a>
    )
}

function ContribStat({ label, value, icon, accent }: { label: string; value: string; icon: string; accent?: boolean }) {
    return (
        <div style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid #1a1a1a" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 14 }}>{icon}</span>
                <span style={{ fontSize: 9, color: "#666", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {label}
                </span>
            </div>
            <div style={{
                fontSize: 20, fontWeight: 700,
                fontFamily: "JetBrains Mono, monospace",
                color: accent ? "#00d4aa" : "#f0f0f0",
            }}>
                {value}
            </div>
        </div>
    )
}

function hasSocials(profile: UserProfile | null): boolean {
    if (!profile) return false
    return !!(profile.socialLinks.github || profile.socialLinks.twitter || profile.socialLinks.website || profile.username)
}
