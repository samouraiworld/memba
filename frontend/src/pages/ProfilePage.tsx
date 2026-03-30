import { useState, useEffect, useCallback } from "react"
import { useParams, useNavigate, useOutletContext } from "react-router-dom"
import { ErrorToast } from "../components/ui/ErrorToast"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { GitHubIcon } from "../components/ui/GitHubIcon"
import { ConnectingLoader } from "../components/ui/ConnectingLoader"
import { GNOLOVE_API_URL, GITHUB_OAUTH_CLIENT_ID, API_BASE_URL, getExplorerBaseUrl } from "../lib/config"
import { resolveAvatarUrl } from "../lib/ipfs"
import { fetchUserProfile, updateBackendProfile, type UserProfile } from "../lib/profile"
import { MetaChip, SocialLink, ContribStat, EditField, RegisterUsernameForm, MyVotesSection } from "../components/profile"
import { DAOMembershipsCard } from "../components/profile/DAOMembershipsCard"
import { AvatarUploader } from "../components/profile/AvatarUploader"
import type { LayoutContext } from "../types/layout"
import "./profile.css"

function hasSocials(profile: UserProfile | null): boolean {
    if (!profile) return false
    return !!(profile.socialLinks.github || profile.socialLinks.twitter || profile.socialLinks.website || profile.username)
}

export function ProfilePage() {
    const { address } = useParams<{ address: string }>()
    const navigate = useNavigate()
    const { adena, auth, isLoggingIn } = useOutletContext<LayoutContext>()

    const [profile, setProfile] = useState<UserProfile | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [editing, setEditing] = useState(false)
    const [saving, setSaving] = useState(false)
    const [saveSuccess, setSaveSuccess] = useState(false)
    const [avatarError, setAvatarError] = useState(false)
    const [editForm, setEditForm] = useState({
        bio: "", company: "", title: "", avatarUrl: "",
        twitter: "", github: "", website: "",
    })

    const isOwnProfile = adena.address === address

    const loadProfile = useCallback(async () => {
        if (!address) return
        setLoading(true)
        setError(null)
        setAvatarError(false)
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

    // Show ConnectingLoader while wallet is syncing (fixes audit M1)
    if (isLoggingIn) {
        return <ConnectingLoader />
    }

    if (!address) {
        return (
            <div className="animate-fade-in profile-no-address">
                <p>No address specified</p>
            </div>
        )
    }

    if (loading) {
        return (
            <div className="animate-fade-in profile-skeleton-col">
                <SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
        )
    }

    const avatar = resolveAvatarUrl(profile?.avatarUrl || profile?.githubAvatar || "")
    const displayName = profile?.username || `${address.slice(0, 10)}...${address.slice(-4)}`
    const explorerUrl = getExplorerBaseUrl()

    return (
        <div className="animate-fade-in profile-container">
            {/* Back nav */}
            <button
                id="profile-back-btn"
                aria-label="Go back"
                onClick={() => navigate(-1)}
                className="profile-back-btn"
            >
                ← Back
            </button>

            {/* ── Profile Header Card ─────────────────────────────── */}
            <div className="k-card profile-header">
                {/* Gradient accent */}
                <div className="profile-header-accent" />

                <div className="profile-header-row">
                    {/* Avatar (B13: React-idiomatic fallback) */}
                    <div className="profile-avatar">
                        {avatar && !avatarError ? (
                            <img
                                src={avatar}
                                alt="Avatar"
                                referrerPolicy="no-referrer"
                                onError={() => setAvatarError(true)}
                            />
                        ) : (
                            <span className="profile-avatar-fallback">👤</span>
                        )}
                    </div>

                    {/* Identity */}
                    <div className="profile-identity">
                        <div className="profile-name-row">
                            <h2 className="profile-name">
                                {displayName}
                            </h2>
                            {isOwnProfile && (
                                <span className="profile-badge-you">YOU</span>
                            )}
                            {isOwnProfile && auth.isAuthenticated && !editing && (
                                <button onClick={startEditing} className="profile-edit-btn">
                                    ✏️ Edit
                                </button>
                            )}
                            {saveSuccess && (
                                <span className="profile-saved-indicator">✓ Saved</span>
                            )}
                        </div>

                        <div className="profile-address-row">
                            <CopyableAddress address={address} />
                        </div>

                        {/* Username Registration (own profile, no username) */}
                        {isOwnProfile && !profile?.username && auth.isAuthenticated && adena.address && (
                            <RegisterUsernameForm address={adena.address} onRegistered={loadProfile} />
                        )}

                        {/* Bio */}
                        {(profile?.bio || profile?.githubBio) && (
                            <p className="profile-bio">
                                {profile.bio || profile.githubBio}
                            </p>
                        )}
                    </div>
                </div>

                {/* Meta: company, title, location */}
                <div className="profile-meta-row">
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
                <div className="k-card profile-edit-card">
                    <h3 className="profile-edit-title">
                        ✏️ Edit Profile
                    </h3>
                    <div className="profile-edit-grid">
                        <EditField label="Bio" value={editForm.bio} onChange={(v) => setEditForm(f => ({ ...f, bio: v }))} multiline maxLen={512} fullWidth />
                        <EditField label="Company" value={editForm.company} onChange={(v) => setEditForm(f => ({ ...f, company: v }))} maxLen={128} />
                        <EditField label="Title / Role" value={editForm.title} onChange={(v) => setEditForm(f => ({ ...f, title: v }))} maxLen={128} />
                        <div className="profile-edit-fullwidth">
                            <AvatarUploader
                                currentUrl={editForm.avatarUrl}
                                onUrlChange={(url) => setEditForm(f => ({ ...f, avatarUrl: url }))}
                            />
                        </div>
                        <EditField label="Twitter / X" value={editForm.twitter} onChange={(v) => setEditForm(f => ({ ...f, twitter: v }))} maxLen={256} placeholder="@handle or URL" />
                        <EditField label="GitHub" value={editForm.github} onChange={(v) => setEditForm(f => ({ ...f, github: v }))} maxLen={256} placeholder="https://github.com/..." />
                        <EditField label="Website" value={editForm.website} onChange={(v) => setEditForm(f => ({ ...f, website: v }))} maxLen={256} placeholder="https://..." />
                    </div>
                    <div className="profile-edit-actions">
                        <button
                            onClick={() => setEditing(false)}
                            disabled={saving}
                            className="profile-btn-cancel"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className={`profile-btn-save${saving ? " saving" : ""}`}
                        >
                            {saving ? "Saving..." : "✅ Save Profile"}
                        </button>
                    </div>
                </div>
            )}

            {/* ── Social Links ─────────────────────────────────────── */}
            {hasSocials(profile) && (
                <div className="profile-socials-row">
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
                <div className="k-card profile-github-cta">
                    <div className="profile-github-cta-row">
                        <div className="profile-github-icon-box">
                            <GitHubIcon size={22} color="#58a6ff" />
                        </div>
                        <div className="profile-github-cta-text">
                            <h4 className="profile-github-cta-title">
                                Link your GitHub account
                            </h4>
                            <p className="profile-github-cta-desc">
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
                            className="profile-github-link-btn"
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
                    className="profile-unlink-btn"
                >
                    Unlink GitHub
                </button>
            )}

            {/* ── Gnolove Contribution Stats ───────────────────────── */}
            {profile && profile.lovePowerScore > 0 && (
                <div className="k-card profile-contrib-card">
                    <div className="profile-contrib-header">
                        <h3 className="profile-contrib-title">
                            ❤️ Gno Contributions
                        </h3>
                        <a href="/gnolove" className="profile-contrib-link">
                            View full analytics →
                        </a>
                    </div>

                    <div className="profile-contrib-grid">
                        <ContribStat label="Love Power" value={String(profile.lovePowerScore)} icon="💜" accent />
                        <ContribStat label="Commits" value={String(profile.totalCommits)} icon="📝" />
                        <ContribStat label="Pull Requests" value={String(profile.totalPRs)} icon="🔀" />
                        <ContribStat label="Issues" value={String(profile.totalIssues)} icon="🐛" />
                        <ContribStat label="Reviews" value={String(profile.totalReviews)} icon="👁" />
                    </div>

                    {/* Score formula note */}
                    <div className="profile-score-formula">
                        Score = commits×10 + PRs×2 + issues×0.5 + reviews×2
                    </div>
                </div>
            )}

            {/* ── Deployed Packages/Realms ──────────────────────────── */}
            {profile && profile.deployedPackages.length > 0 && (
                <div className="k-card profile-packages-card">
                    <h3 className="profile-section-title">
                        📦 Deployed Packages ({profile.deployedPackages.length})
                    </h3>
                    <div className="profile-packages-list">
                        {profile.deployedPackages.slice(0, 20).map((pkg) => (
                            <a
                                key={pkg.path}
                                href={`${explorerUrl}/${pkg.path}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="k-card profile-package-item"
                            >
                                <span className="profile-package-path">
                                    {pkg.path}
                                </span>
                                <span className="profile-package-block">
                                    Block #{pkg.blockHeight}
                                </span>
                            </a>
                        ))}
                        {profile.deployedPackages.length > 20 && (
                            <div className="profile-packages-more">
                                +{profile.deployedPackages.length - 20} more
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Governance Votes / My Votes ────────────────────────── */}
            {profile && isOwnProfile && <MyVotesSection address={address || ""} gnoloveVotes={profile.governanceVotes} />}
            {profile && !isOwnProfile && profile.governanceVotes.length > 0 && (
                <div className="k-card profile-votes-card">
                    <h3 className="profile-section-title">
                        🗳️ Governance Votes ({profile.governanceVotes.length})
                    </h3>
                    <div className="profile-votes-list">
                        {profile.governanceVotes.slice(0, 20).map((v, i) => {
                            const voteColor = v.vote === "YES" ? "#4caf50" : v.vote === "NO" ? "#f44336" : "#888"
                            return (
                                <div key={i} className="k-card profile-vote-item">
                                    <div>
                                        <span className="profile-vote-id">
                                            Prop #{v.proposalId}
                                        </span>
                                        <span className="profile-vote-title">
                                            {v.proposalTitle}
                                        </span>
                                    </div>
                                    <span
                                        className="profile-vote-badge"
                                        style={{ background: `${voteColor}15`, color: voteColor }}
                                    >
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
                <div className="k-dashed profile-empty">
                    <div className="profile-empty-icon">
                        <span style={{ fontSize: 28 }}>👤</span>
                    </div>
                    <h3 className="profile-empty-title">No profile data yet</h3>
                    <p className="profile-empty-desc">
                        This address has no registered username, GitHub activity, or on-chain deployments.
                    </p>
                </div>
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}
