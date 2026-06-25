/** ValoperDetail — in-app "Blend" profile for one registered valoper, at
 *  /:network/validators/valoper/:operatorAddress.
 *
 *  Layout: an identity header (avatar / moniker / status / bio / socials /
 *  addresses) + a tab bar (Overview · Reviews · Quests · Contributions ·
 *  Activity). It composes two data sources, in parallel and with graceful
 *  degradation:
 *    - the valoper detail (r/gnops/valopers Render → parseValoperDetail) — the
 *      page renders from this ALONE if the profile fetch fails;
 *    - the hybrid `UserProfile` (gnolove + on-chain username + Memba backend),
 *      which enriches the header and fills the Contributions / Activity tabs.
 *
 *  P1 is read-only. Editing (the disabled "Edit profile" button), the indexer
 *  activity feed (Activity beyond gov votes), Quests, and the on-chain Reviews
 *  realm are SEPARATE follow-ups, scaffolded here as honest "coming soon". */
import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useLocation, useOutletContext, useParams } from "react-router-dom"
import { Copy, CheckCircle, GlobeSimple, GithubLogo, XLogo, PencilSimple } from "@phosphor-icons/react"
import { GNO_RPC_URL, GNO_CHAIN_ID, GNOLOVE_API_URL, getExplorerBaseUrl } from "../lib/config"
import { queryRender } from "../lib/dao/shared"
import {
    VALOPERS_REALM,
    parseValoperDetail,
    computeValoperStatus,
    type ValoperWithStatus,
} from "../lib/valopers"
import { getValidators } from "../lib/validators"
import { fetchUserProfile, type UserProfile } from "../lib/profile"
import { resolveAvatarUrl } from "../lib/ipfs"
import { useNetworkPath } from "../hooks/useNetworkNav"
import { ValoperEditDialog } from "../components/validators/ValoperEditDialog"
import type { LayoutContext } from "../types/layout"
import "./validator-detail.css"
import "./valoper-detail.css"

const SERVER_TYPE_LABEL: Record<string, string> = {
    "cloud": "Cloud",
    "on-prem": "On-prem",
    "data-center": "Data center",
}

const TABS = ["Overview", "Reviews", "Quests", "Contributions", "Activity"] as const
type TabKey = (typeof TABS)[number]

function CopyBtn({ text }: { text: string }) {
    const [copied, setCopied] = useState(false)
    return (
        <button
            className="vd-copy"
            title="Copy to clipboard"
            aria-label="Copy"
            onClick={() => {
                navigator.clipboard.writeText(text).catch(() => {})
                setCopied(true)
                setTimeout(() => setCopied(false), 1400)
            }}
        >
            {copied ? <CheckCircle size={13} weight="fill" /> : <Copy size={13} />}
        </button>
    )
}

function AddrRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
    if (!value) return null
    return (
        <div className="vd-row">
            <span className="vd-row__label">
                {label}
                {hint && <span className="vp-row__hint"> · {hint}</span>}
            </span>
            <span className="vd-row__value vd-mono">
                {value}
                <CopyBtn text={value} />
            </span>
        </div>
    )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
    return (
        <div className="vd-stat-card">
            <span className="vd-stat-label">{label}</span>
            <span className={`vd-stat-value${accent ? " vd-val-ok" : ""}`}>{value}</span>
        </div>
    )
}

/** Honest "not live yet" panel reused by Reviews / Quests / the activity note. */
function ComingSoonPanel({ title, body }: { title: string; body: string }) {
    return (
        <div className="vp-soon">
            <span className="vp-soon__badge">soon · not live yet</span>
            <h3 className="vp-soon__title">{title}</h3>
            <p className="vp-soon__body">{body}</p>
        </div>
    )
}

export default function ValoperDetail() {
    const { operatorAddress } = useParams<{ operatorAddress: string }>()
    const location = useLocation()
    const np = useNetworkPath()
    // The page also renders standalone (e.g. some tests / deep links) where no
    // Layout outlet is present, so tolerate a null context — owner detection just
    // resolves to "not owner" and the read-only page is unaffected.
    const ctx = useOutletContext<LayoutContext | null>()
    const preset = (location.state as { valoper?: ValoperWithStatus } | null)?.valoper ?? null

    const [valoper, setValoper] = useState<ValoperWithStatus | null>(preset)
    const [profile, setProfile] = useState<UserProfile | null>(null)
    const [loading, setLoading] = useState(!preset)
    const [notFound, setNotFound] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [tab, setTab] = useState<TabKey>("Overview")
    const [avatarError, setAvatarError] = useState(false)
    const [editOpen, setEditOpen] = useState(false)
    const abortRef = useRef<AbortController | null>(null)

    const load = useCallback(async () => {
        if (!operatorAddress) return
        abortRef.current?.abort()
        const ctrl = new AbortController()
        abortRef.current = ctrl
        // The profile fetch is independent of the valoper fetch — kick it off in
        // parallel and tolerate failure (graceful degradation: the page renders
        // from valoper data alone). It never gates loading or the not-found path.
        void fetchUserProfile(GNOLOVE_API_URL, operatorAddress)
            .then((p) => { if (!ctrl.signal.aborted) setProfile(p) })
            .catch(() => { /* keep profile null; header falls back to valoper data */ })
        try {
            const raw = await queryRender(GNO_RPC_URL, VALOPERS_REALM, operatorAddress)
            if (ctrl.signal.aborted) return
            const detail = raw ? parseValoperDetail(raw) : null
            if (!detail) {
                setNotFound(true)
                setLoading(false)
                return
            }
            const vals = await getValidators(GNO_RPC_URL)
            if (ctrl.signal.aborted) return
            const active = new Set(vals.map(v => v.gnoAddr))
            setValoper({ ...detail, status: computeValoperStatus(detail.signingAddress, active) })
            setLoading(false)
        } catch (e) {
            if (!ctrl.signal.aborted) {
                setError(e instanceof Error ? e.message : "Failed to load valoper")
                setLoading(false)
            }
        }
    }, [operatorAddress])

    // Re-fetch just the editable/hybrid profile (used after a successful edit save).
    // The valoper detail is on-chain and unchanged by editing, so we don't reload it.
    const refreshProfile = useCallback(async () => {
        if (!operatorAddress) return
        try {
            const p = await fetchUserProfile(GNOLOVE_API_URL, operatorAddress)
            setProfile(p)
        } catch { /* keep the previous profile; the edit still succeeded */ }
    }, [operatorAddress])

    useEffect(() => {
        // load() only sets state after an await (async fetch), not synchronously — this
        // is a fetch-on-mount, so the rule's "synchronous setState" warning is a false
        // positive here (it flags the transitive setState inside load).
        // eslint-disable-next-line react-hooks/set-state-in-effect
        load()
        return () => abortRef.current?.abort()
    }, [load])

    useEffect(() => {
        document.title = valoper?.moniker ? `${valoper.moniker} — Valoper — Memba` : "Valoper — Memba"
        return () => { document.title = "Memba" }
    }, [valoper?.moniker])

    const gnowebUrl = operatorAddress ? `${getExplorerBaseUrl()}/r/gnops/valopers:${operatorAddress}` : "#"

    // ── loading ──
    if (loading) {
        return (
            <div className="vd-page">
                <div className="vd-nav">
                    <Link to={np("validators")} className="vd-back">← Validators</Link>
                </div>
                <div className="vd-loading">
                    <span className="hk-pulse" />
                    <span>Loading valoper…</span>
                </div>
            </div>
        )
    }

    // ── error ──
    if (error && !valoper) {
        return (
            <div className="vd-page">
                <div className="vd-nav">
                    <Link to={np("validators")} className="vd-back">← Validators</Link>
                </div>
                <div className="vd-notfound">
                    <span className="vd-notfound__icon">⚠</span>
                    <h2>Failed to load valoper</h2>
                    <p className="vd-mono">{error}</p>
                    <button
                        onClick={() => { setError(null); setLoading(true); void load() }}
                        className="vd-btn-back"
                        style={{ marginTop: 12 }}
                    >
                        Retry
                    </button>
                </div>
            </div>
        )
    }

    // ── not found ──
    if (notFound || !valoper) {
        return (
            <div className="vd-page">
                <div className="vd-nav">
                    <Link to={np("validators")} className="vd-back">← Validators</Link>
                </div>
                <div className="vd-notfound">
                    <span className="vd-notfound__icon">⚠</span>
                    <h2>Valoper not found</h2>
                    <p className="vd-mono">{operatorAddress}</p>
                    <p>No valoper is registered at this operator address on <strong>{GNO_CHAIN_ID}</strong>.</p>
                    <Link to={np("validators")} className="vd-btn-back">← Back to Validators</Link>
                </div>
            </div>
        )
    }

    // ── identity (compose valoper + profile) ──
    const isActive = valoper.status === "active"
    // Owner detection: the connected, authenticated wallet must equal the valoper's
    // operator address (its stable identity). Only then can the profile be edited —
    // editing someone else's profile is not possible (and the backend re-checks the
    // auth token's address on write). A null context (no Layout outlet) ⇒ not owner.
    const connectedAddr = ctx?.adena.address ?? ""
    const isOwner =
        !!connectedAddr &&
        !!ctx?.auth.isAuthenticated &&
        !!ctx?.auth.token &&
        connectedAddr === valoper.operatorAddress
    const avatar = resolveAvatarUrl(profile?.avatarUrl || profile?.githubAvatar || "")
    const showAvatar = !!avatar && !avatarError
    const bio = profile?.bio || profile?.githubBio || valoper.description || ""
    const social = profile?.socialLinks
    const hasSocial = !!(social && (social.website || social.github || social.twitter))
    const initials = valoper.moniker.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "?"

    const onTabKeyDown = (e: React.KeyboardEvent) => {
        const i = TABS.indexOf(tab)
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            e.preventDefault()
            setTab(TABS[(i + 1) % TABS.length])
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            e.preventDefault()
            setTab(TABS[(i - 1 + TABS.length) % TABS.length])
        } else if (e.key === "Home") {
            e.preventDefault()
            setTab(TABS[0])
        } else if (e.key === "End") {
            e.preventDefault()
            setTab(TABS[TABS.length - 1])
        }
    }

    const hasContribs = !!profile && (
        profile.lovePowerScore > 0 ||
        profile.totalCommits > 0 || profile.totalPRs > 0 ||
        profile.totalIssues > 0 || profile.totalReviews > 0 ||
        profile.deployedPackages.length > 0
    )
    const votes = profile?.governanceVotes ?? []

    return (
        <div className="vd-page" data-testid="valoper-detail-page">
            <div className="vd-nav">
                <Link to={np("validators")} className="vd-back">← Validators</Link>
                <span className="vd-nav__sep">/</span>
                <span className="vd-nav__current">{valoper.moniker}</span>
                <span className="vd-nav__chain">{GNO_CHAIN_ID}</span>
            </div>

            {/* ── Identity header ─────────────────────────────────── */}
            <header className="vp-id">
                <div className="vp-id__avatar" aria-hidden={showAvatar ? undefined : "true"}>
                    {showAvatar ? (
                        <img
                            src={avatar}
                            alt={valoper.moniker}
                            referrerPolicy="no-referrer"
                            onError={() => setAvatarError(true)}
                        />
                    ) : (
                        <span className="vp-id__initials" data-testid="vp-avatar-fallback">{initials}</span>
                    )}
                </div>

                <div className="vp-id__main">
                    <div className="vp-id__namerow">
                        <h1 className="vd-moniker">{valoper.moniker}</h1>
                        <span className={`vd-badge ${isActive ? "vd-badge--active" : "vp-badge--candidate"}`}>
                            {isActive ? "● Active" : "○ Candidate"}
                        </span>
                        {valoper.serverType && (
                            <span className="vp-server">
                                {SERVER_TYPE_LABEL[valoper.serverType] ?? valoper.serverType}
                            </span>
                        )}
                    </div>

                    {profile?.username && (
                        <div className="vp-id__userrow">
                            {profile.userRealmUrl ? (
                                <a
                                    href={profile.userRealmUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="vp-id__username"
                                >
                                    {profile.username}
                                </a>
                            ) : (
                                <span className="vp-id__username">{profile.username}</span>
                            )}
                        </div>
                    )}

                    {bio && <p className="vp-id__bio">{bio}</p>}

                    {hasSocial && (
                        <div className="vp-id__socials">
                            {social!.website && (
                                <a href={social!.website} target="_blank" rel="noopener noreferrer" className="vp-soc" aria-label="Website" title="Website">
                                    <GlobeSimple size={16} />
                                </a>
                            )}
                            {social!.github && (
                                <a
                                    href={social!.github.startsWith("http") ? social!.github : `https://github.com/${social!.github}`}
                                    target="_blank" rel="noopener noreferrer" className="vp-soc" aria-label="GitHub" title="GitHub"
                                >
                                    <GithubLogo size={16} />
                                </a>
                            )}
                            {social!.twitter && (
                                <a
                                    href={`https://x.com/${social!.twitter.replace("@", "")}`}
                                    target="_blank" rel="noopener noreferrer" className="vp-soc" aria-label="Twitter / X" title="Twitter / X"
                                >
                                    <XLogo size={16} />
                                </a>
                            )}
                        </div>
                    )}

                    <div className="vp-id__addrs">
                        <AddrRow label="Operator address" value={valoper.operatorAddress} hint="stable identity" />
                        <AddrRow label="Signing address" value={valoper.signingAddress} hint="rotatable consensus key" />
                    </div>
                </div>

                {/* Edit profile (P1b) — only the owner (connected wallet === operator,
                    authenticated) sees it; for everyone else the page is read-only. */}
                {isOwner && (
                    <div className="vp-id__actions">
                        <button
                            type="button"
                            className="vp-edit-btn vp-edit-btn--enabled"
                            onClick={() => setEditOpen(true)}
                            title="Edit your profile"
                        >
                            <PencilSimple size={14} /> Edit profile
                        </button>
                    </div>
                )}
            </header>

            {/* Owner edit dialog — reuses the backend editable-profile API (no new realm). */}
            {isOwner && profile && ctx?.auth.token && (
                <ValoperEditDialog
                    open={editOpen}
                    onClose={() => setEditOpen(false)}
                    profile={profile}
                    token={ctx.auth.token}
                    onSaved={() => { setEditOpen(false); void refreshProfile() }}
                />
            )}

            {/* ── Tab bar ─────────────────────────────────────────── */}
            <div className="vp-tabs" role="tablist" aria-label="Profile sections">
                {TABS.map((t) => (
                    <button
                        key={t}
                        role="tab"
                        id={`vp-tab-${t.toLowerCase()}-btn`}
                        aria-selected={tab === t}
                        aria-controls={`vp-tab-${t.toLowerCase()}`}
                        tabIndex={tab === t ? 0 : -1}
                        className={`vp-tab${tab === t ? " vp-tab--active" : ""}`}
                        onClick={() => setTab(t)}
                        onKeyDown={onTabKeyDown}
                    >
                        {t}
                    </button>
                ))}
            </div>

            {/* ── Overview ────────────────────────────────────────── */}
            {tab === "Overview" && (
                <div role="tabpanel" id="vp-tab-overview" aria-labelledby="vp-tab-overview-btn" data-testid="vp-tab-overview" className="vp-panel">
                    {/* Rating / review hero placeholder — styled as the eventual hero so
                        the slot is real (the on-chain reviews realm is P3). */}
                    <div className="vp-review-hero">
                        <div className="vp-review-hero__score">
                            <span className="vp-review-hero__stars" aria-hidden="true">★★★★★</span>
                            <span className="vp-review-hero__soon">soon</span>
                        </div>
                        <div className="vp-review-hero__copy">
                            <h2 className="vp-review-hero__title">Community reviews — launching soon</h2>
                            <p className="vp-review-hero__sub">
                                On-chain ratings and written reviews for this validator will appear here once
                                the reviews realm goes live.
                            </p>
                        </div>
                    </div>

                    <div className="vd-card">
                        <div className="vd-card__title">Snapshot</div>
                        <div className="vd-stats-grid">
                            <Stat label="Status" value={isActive ? "Active" : "Candidate"} accent={isActive} />
                            <Stat label="Love Power" value={profile ? String(profile.lovePowerScore) : "—"} />
                            <Stat label="Commits" value={profile ? String(profile.totalCommits) : "—"} />
                            <Stat label="Packages" value={profile ? String(profile.deployedPackages.length) : "—"} />
                        </div>
                    </div>

                    <div className="vd-card">
                        <div className="vd-card__title">Identity</div>
                        {/* Operator + signing addresses live in the header; the pubkey is
                            the extra technical detail surfaced here. */}
                        <AddrRow label="Signing pubkey" value={valoper.signingPubKey} />
                        <p className="vp-identity-note">
                            The <strong>operator address</strong> is the valoper's permanent identity; the{" "}
                            <strong>signing address</strong> is the consensus key it currently validates with, and can
                            rotate without changing identity.
                        </p>
                    </div>

                    <div className="vp-peek">
                        <button type="button" className="vp-peek__link" onClick={() => setTab("Contributions")}>
                            View contributions →
                        </button>
                        <button type="button" className="vp-peek__link" onClick={() => setTab("Activity")}>
                            View activity →
                        </button>
                        <a href={gnowebUrl} target="_blank" rel="noopener noreferrer" className="vp-peek__link">
                            View on gnoweb ↗
                        </a>
                    </div>
                </div>
            )}

            {/* ── Reviews (coming soon — P3 realm) ─────────────────── */}
            {tab === "Reviews" && (
                <div role="tabpanel" id="vp-tab-reviews" aria-labelledby="vp-tab-reviews-btn" data-testid="vp-tab-reviews" className="vp-panel">
                    <ComingSoonPanel
                        title="Community reviews are coming soon"
                        body="An on-chain reviews realm will let delegators and peers rate and review this validator. It is not live yet."
                    />
                </div>
            )}

            {/* ── Quests (coming soon — P2) ────────────────────────── */}
            {tab === "Quests" && (
                <div role="tabpanel" id="vp-tab-quests" aria-labelledby="vp-tab-quests-btn" data-testid="vp-tab-quests" className="vp-panel">
                    <ComingSoonPanel
                        title="Quests & achievements are coming soon"
                        body="Validator quests and earned badges will show here. This surface is not live yet."
                    />
                </div>
            )}

            {/* ── Contributions (real gnolove data) ────────────────── */}
            {tab === "Contributions" && (
                <div role="tabpanel" id="vp-tab-contributions" aria-labelledby="vp-tab-contributions-btn" data-testid="vp-tab-contributions" className="vp-panel">
                    {hasContribs ? (
                        <>
                            <div className="vd-card">
                                <div className="vd-card__title">Gno contributions</div>
                                <div className="vd-stats-grid">
                                    <Stat label="Love Power" value={String(profile!.lovePowerScore)} accent />
                                    <Stat label="Commits" value={String(profile!.totalCommits)} />
                                    <Stat label="Pull Requests" value={String(profile!.totalPRs)} />
                                    <Stat label="Issues" value={String(profile!.totalIssues)} />
                                    <Stat label="Reviews" value={String(profile!.totalReviews)} />
                                </div>
                            </div>

                            {profile!.deployedPackages.length > 0 && (
                                <div className="vd-card">
                                    <div className="vd-card__title">
                                        Deployed packages ({profile!.deployedPackages.length})
                                    </div>
                                    <div className="vp-pkgs">
                                        {profile!.deployedPackages.slice(0, 20).map((pkg) => (
                                            <a
                                                key={pkg.path}
                                                href={`${getExplorerBaseUrl()}/${pkg.path}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="vp-pkg"
                                            >
                                                <span className="vp-pkg__path vd-mono">{pkg.path}</span>
                                                <span className="vp-pkg__block">#{pkg.blockHeight}</span>
                                            </a>
                                        ))}
                                        {profile!.deployedPackages.length > 20 && (
                                            <span className="vp-pkgs__more">
                                                +{profile!.deployedPackages.length - 20} more
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="vd-card vp-empty">
                            <p>No gno contributions found for this address.</p>
                            <p className="vp-empty__sub">
                                Contribution stats come from gnolove. If this validator hasn't linked a GitHub
                                identity or has no on-chain activity yet, there's nothing to show.
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* ── Activity (gov votes now; full feed is P2) ────────── */}
            {tab === "Activity" && (
                <div role="tabpanel" id="vp-tab-activity" aria-labelledby="vp-tab-activity-btn" data-testid="vp-tab-activity" className="vp-panel">
                    {votes.length > 0 ? (
                        <div className="vd-card">
                            <div className="vd-card__title">Governance votes ({votes.length})</div>
                            <div className="vp-votes">
                                {votes.slice(0, 20).map((v, i) => {
                                    const cls = v.vote === "YES" ? "vp-vote--yes" : v.vote === "NO" ? "vp-vote--no" : "vp-vote--abstain"
                                    return (
                                        <div key={`${v.proposalId}-${i}`} className="vp-vote">
                                            <div className="vp-vote__meta">
                                                <span className="vp-vote__id">Prop #{v.proposalId}</span>
                                                <span className="vp-vote__title">{v.proposalTitle}</span>
                                            </div>
                                            <span className={`vp-vote__badge ${cls}`}>{v.vote}</span>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    ) : (
                        <div className="vd-card vp-empty">
                            <p>No governance votes recorded for this address yet.</p>
                        </div>
                    )}

                    <div className="vd-card">
                        <ComingSoonPanel
                            title="Full on-chain activity is coming soon"
                            body="Governance votes are a first cut. A complete by-address activity feed (transactions, deployments, transfers) from the chain indexer is on the way."
                        />
                    </div>
                </div>
            )}
        </div>
    )
}
