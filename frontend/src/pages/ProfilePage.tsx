import { useState, useEffect, useCallback } from "react"
import { useParams, useNavigate, useOutletContext } from "react-router-dom"
import { ErrorToast } from "../components/ui/ErrorToast"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { GitHubIcon } from "../components/ui/GitHubIcon"
import { GNOLOVE_API_URL, GITHUB_OAUTH_CLIENT_ID, API_BASE_URL, getExplorerBaseUrl } from "../lib/config"
import { fetchUserProfile, updateBackendProfile, type UserProfile } from "../lib/profile"
import { MetaChip, SocialLink, ContribStat, EditField, RegisterUsernameForm, MyVotesSection } from "../components/profile"
import { DAOMembershipsCard } from "../components/profile/DAOMembershipsCard"
import { AvatarUploader } from "../components/profile/AvatarUploader"
import type { LayoutContext } from "../types/layout"

function hasSocials(profile: UserProfile | null): boolean {
    if (!profile) return false
    return !!(profile.socialLinks.github || profile.socialLinks.twitter || profile.socialLinks.website || profile.username)
}

export function ProfilePage() {
    const { address } = useParams<{ address: string }>()
    const navigate = useNavigate()
    const { adena, auth } = useOutletContext<LayoutContext>()

    const [profile, setProfile] = useState<UserProfile | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [editing, setEditing] = useState(false)
    const [saving, setSaving] = useState(false)
    const [saveSuccess, setSaveSuccess] = useState(false)
    const [editForm, setEditForm] = useState({
        bio: "", company: "", title: "", avatarUrl: "",
        twitter: "", github: "", website: "",
    })

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

    // Auto-apply pending GitHub link (deferred from OAuth redirect)
    useEffect(() => {
        const pending = localStorage.getItem("pendingGithubLink")
        if (pending && auth.isAuthenticated && auth.token && isOwnProfile) {
            try {
                const { login, ts } = JSON.parse(pending)
                if (Date.now() - ts < 600_000) { // 10min expiry
                    const ghUrl = login.startsWith("http") ? login : `https://github.com/${login}`
                    updateBackendProfile(auth.token, { github: ghUrl })
                        .then(() => { localStorage.removeItem("pendingGithubLink"); loadProfile() })
                        .catch(() => { /* silent — user can retry manually */ })
                } else {
                    localStorage.removeItem("pendingGithubLink")
                }
            } catch { localStorage.removeItem("pendingGithubLink") }
        }
    }, [auth.isAuthenticated, auth.token, isOwnProfile, loadProfile])

    const startEditing = () => {
        if (!profile) return
        setEditForm({
            bio: profile.bio, company: profile.company, title: profile.title,
            avatarUrl: profile.avatarUrl,
            twitter: profile.socialLinks.twitter, github: profile.socialLinks.github,
            website: profile.socialLinks.website,
        })
        setEditing(true)
        setSaveSuccess(false)
    }

    const handleSave = async () => {
        if (!auth.token) return
        setSaving(true)
        setError(null)
        try {
            await updateBackendProfile(auth.token, editForm)
            // Optimistic update: show new avatar immediately (Bug 1.3)
            setProfile(prev => prev ? { ...prev, avatarUrl: editForm.avatarUrl } : prev)
            setEditing(false)
            setSaveSuccess(true)
            setTimeout(() => setSaveSuccess(false), 3000)
            loadProfile() // background re-fetch for other fields
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to save profile")
        } finally {
            setSaving(false)
        }
    }

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

    const avatar = profile?.avatarUrl || profile?.githubAvatar || ""
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
                        background: "rgba(0,212,170,0.08)",
                        border: "2px solid rgba(0,212,170,0.2)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0, overflow: "hidden",
                    }}>
                        {avatar ? (
                            <img
                                src={avatar}
                                alt="Avatar"
                                referrerPolicy="no-referrer"
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                onError={(e) => { e.currentTarget.style.display = "none"; const sib = e.currentTarget.nextElementSibling as HTMLElement | null; if (sib) sib.style.display = "flex" }}
                            />
                        ) : null}
                        <span style={{ fontSize: 28, color: "#00d4aa", display: avatar ? "none" : "flex" }}>👤</span>
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
                            {isOwnProfile && auth.isAuthenticated && !editing && (
                                <button
                                    onClick={startEditing}
                                    style={{
                                        padding: "3px 10px", borderRadius: 4, fontSize: 10,
                                        fontFamily: "JetBrains Mono, monospace",
                                        background: "rgba(255,255,255,0.04)", border: "1px solid #222",
                                        color: "#888", cursor: "pointer", transition: "border-color 0.15s, color 0.15s",
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#00d4aa"; e.currentTarget.style.color = "#00d4aa" }}
                                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#222"; e.currentTarget.style.color = "#888" }}
                                >
                                    ✏️ Edit
                                </button>
                            )}
                            {saveSuccess && (
                                <span style={{ fontSize: 10, color: "#4caf50", fontFamily: "JetBrains Mono, monospace" }}>✓ Saved</span>
                            )}
                        </div>

                        <div style={{ marginTop: 6 }}>
                            <CopyableAddress address={address} />
                        </div>

                        {/* Username Registration (own profile, no username) */}
                        {isOwnProfile && !profile?.username && auth.isAuthenticated && adena.address && (
                            <RegisterUsernameForm address={adena.address} onRegistered={loadProfile} />
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

            {/* ── Edit Profile Form ────────────────────────────────── */}
            {editing && (
                <div className="k-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f0f0f0", marginBottom: 16 }}>
                        ✏️ Edit Profile
                    </h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <EditField label="Bio" value={editForm.bio} onChange={(v) => setEditForm(f => ({ ...f, bio: v }))} multiline maxLen={512} fullWidth />
                        <EditField label="Company" value={editForm.company} onChange={(v) => setEditForm(f => ({ ...f, company: v }))} maxLen={128} />
                        <EditField label="Title / Role" value={editForm.title} onChange={(v) => setEditForm(f => ({ ...f, title: v }))} maxLen={128} />
                        <div style={{ gridColumn: "1 / -1" }}>
                            <AvatarUploader
                                currentUrl={editForm.avatarUrl}
                                onUrlChange={(url) => setEditForm(f => ({ ...f, avatarUrl: url }))}
                            />
                        </div>
                        <EditField label="Twitter / X" value={editForm.twitter} onChange={(v) => setEditForm(f => ({ ...f, twitter: v }))} maxLen={256} placeholder="@handle or URL" />
                        <EditField label="GitHub" value={editForm.github} onChange={(v) => setEditForm(f => ({ ...f, github: v }))} maxLen={256} placeholder="https://github.com/..." />
                        <EditField label="Website" value={editForm.website} onChange={(v) => setEditForm(f => ({ ...f, website: v }))} maxLen={256} placeholder="https://..." />
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
                        <button
                            onClick={() => setEditing(false)}
                            disabled={saving}
                            style={{
                                padding: "6px 16px", borderRadius: 6, fontSize: 11,
                                fontFamily: "JetBrains Mono, monospace",
                                background: "none", border: "1px solid #333",
                                color: "#888", cursor: "pointer",
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            style={{
                                padding: "6px 16px", borderRadius: 6, fontSize: 11,
                                fontFamily: "JetBrains Mono, monospace",
                                background: saving ? "rgba(0,212,170,0.1)" : "rgba(0,212,170,0.15)",
                                border: "1px solid rgba(0,212,170,0.3)",
                                color: "#00d4aa", cursor: saving ? "wait" : "pointer",
                            }}
                        >
                            {saving ? "Saving..." : "✅ Save Profile"}
                        </button>
                    </div>
                </div>
            )}

            {/* ── Social Links ─────────────────────────────────────── */}
            {hasSocials(profile) && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {profile?.socialLinks.github && (
                        <SocialLink href={profile.socialLinks.github.startsWith("http") ? profile.socialLinks.github : `https://github.com/${profile.socialLinks.github}`} icon={<GitHubIcon size={14} color="#f0f0f0" />} label="GitHub" />
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

            {/* ── DAO Memberships ─────────────────────────────────── */}
            {address && <DAOMembershipsCard address={address} isOwnProfile={isOwnProfile} />}

            {/* ── Link GitHub CTA (own profile, no GitHub linked) ──── */}
            {isOwnProfile && profile && !profile.githubLogin && !profile.socialLinks.github && (
                <div className="k-card" style={{ padding: 20, borderColor: "rgba(88,166,255,0.15)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                        <div style={{
                            width: 44, height: 44, borderRadius: 10,
                            background: "rgba(88,166,255,0.06)", border: "1px solid rgba(88,166,255,0.15)",
                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                        }}>
                            <GitHubIcon size={22} color="#58a6ff" />
                        </div>
                        <div style={{ flex: 1, minWidth: 180 }}>
                            <h4 style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f0", marginBottom: 4 }}>
                                Link your GitHub account
                            </h4>
                            <p style={{ fontSize: 11, color: "#666", fontFamily: "JetBrains Mono, monospace", maxWidth: 400 }}>
                                Link your GitHub to verify your on-chain identity and show your contribution stats, avatar, and deployed packages.
                            </p>
                        </div>
                        <button
                            onClick={async () => {
                                // Save address for OAuth return redirect (F3)
                                if (adena.address) sessionStorage.setItem("returnToProfile", adena.address)
                                try {
                                    const res = await fetch(`${API_BASE_URL}/github/oauth/state`)
                                    const data = await res.json()
                                    const state = data.state || ""
                                    const redirectUri = encodeURIComponent(window.location.origin + "/github/callback")
                                    window.location.href = `https://github.com/login/oauth/authorize?client_id=${GITHUB_OAUTH_CLIENT_ID}&redirect_uri=${redirectUri}&scope=read:user&state=${state}`
                                } catch {
                                    // Fallback: redirect without state (will fail validation, but won't crash)
                                    const redirectUri = encodeURIComponent(window.location.origin + "/github/callback")
                                    window.location.href = `https://github.com/login/oauth/authorize?client_id=${GITHUB_OAUTH_CLIENT_ID}&redirect_uri=${redirectUri}&scope=read:user`
                                }
                            }}
                            style={{
                                display: "inline-flex", alignItems: "center", gap: 6,
                                padding: "8px 16px", borderRadius: 6, fontSize: 11,
                                fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                background: "rgba(88,166,255,0.1)", border: "1px solid rgba(88,166,255,0.25)",
                                color: "#58a6ff", cursor: "pointer",
                                transition: "background 0.15s, border-color 0.15s",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(88,166,255,0.2)"; e.currentTarget.style.borderColor = "rgba(88,166,255,0.4)" }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(88,166,255,0.1)"; e.currentTarget.style.borderColor = "rgba(88,166,255,0.25)" }}
                        >
                            <GitHubIcon size={12} color="#58a6ff" /> Link GitHub →
                        </button>
                    </div>
                </div>
            )}

            {/* ── Unlink GitHub (own profile, GitHub already linked) ── */}
            {isOwnProfile && profile && (profile.socialLinks.github || profile.githubLogin) && auth.isAuthenticated && (
                <button
                    onClick={async () => {
                        try {
                            if (!auth.token) return
                            await updateBackendProfile(auth.token, { github: "" })
                            loadProfile()
                        } catch { /* silent */ }
                    }}
                    style={{
                        background: "none", border: "1px solid #333",
                        color: "#888", fontSize: 11, padding: "6px 14px",
                        borderRadius: 6, cursor: "pointer",
                        fontFamily: "JetBrains Mono, monospace",
                        transition: "border-color 0.15s, color 0.15s",
                        alignSelf: "flex-start",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#ff4757"; e.currentTarget.style.color = "#ff4757" }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#333"; e.currentTarget.style.color = "#888" }}
                >
                    Unlink GitHub
                </button>
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

            {/* ── Governance Votes / My Votes ────────────────────────── */}
            {profile && isOwnProfile && <MyVotesSection address={address || ""} gnoloveVotes={profile.governanceVotes} />}
            {profile && !isOwnProfile && profile.governanceVotes.length > 0 && (
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
