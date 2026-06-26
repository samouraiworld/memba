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
import {
    Copy, CheckCircle, GlobeSimple, GithubLogo, XLogo, PencilSimple,
    Coins, Package, Scales, ShieldCheck, ArrowsLeftRight, Play, Cube, ArrowClockwise,
} from "@phosphor-icons/react"
import { GNO_RPC_URL, GNO_CHAIN_ID, GNOLOVE_API_URL, getExplorerBaseUrl } from "../lib/config"
import { queryRender } from "../lib/dao/shared"
import {
    VALOPERS_REALM,
    parseValoperDetail,
    computeValoperStatus,
    type ValoperWithStatus,
} from "../lib/valopers"
import { getValidators, truncateValidatorAddr } from "../lib/validators"
import { fetchUserProfile, type UserProfile } from "../lib/profile"
import { resolveAvatarUrl } from "../lib/ipfs"
import { useNetworkPath } from "../hooks/useNetworkNav"
import { useAddressActivity } from "../hooks/useAddressActivity"
import { formatActivityTime, type ActivityItem, type ActivityKind } from "../lib/activity"
import { loadQuestProgress, fetchUserQuests, type UserQuestState } from "../lib/quests"
import { getQuestById, calculateRank, xpToNextRank } from "../lib/gnobuilders"
import { ValoperEditDialog } from "../components/validators/ValoperEditDialog"
import type { LayoutContext } from "../types/layout"
import "./validator-detail.css"
import "./valoper-detail.css"

/** Icon per activity kind — mirrors the home ActivityFeed mapping. */
const KIND_ICON: Record<ActivityKind, typeof Coins> = {
    token: Coins,
    deploy: Package,
    governance: Scales,
    validator: ShieldCheck,
    transfer: ArrowsLeftRight,
    run: Play,
    call: Cube,
}

/** gnoweb realm link for an item with a package path; null otherwise. */
function activityHref(item: ActivityItem): string | null {
    if (!item.pkgPath) return null
    return `${getExplorerBaseUrl()}${item.pkgPath.replace(/^gno\.land/, "")}`
}

/** One on-chain activity row, in the ActivityFeed style but page-token-driven. */
function ActivityRow({ item }: { item: ActivityItem }) {
    const Icon = KIND_ICON[item.kind] ?? Cube
    const href = activityHref(item)
    const when = formatActivityTime(item.time)
    const inner = (
        <>
            <span className={`vp-act__icon vp-act__icon--${item.kind}`} aria-hidden="true">
                <Icon size={15} weight="bold" />
            </span>
            <span className="vp-act__body">
                <span className="vp-act__title">
                    {item.title}
                    {item.extraCount > 0 && <span className="vp-act__more"> · +{item.extraCount} more</span>}
                </span>
                <span className="vp-act__meta">
                    {item.actor && <span className="vp-act__actor vd-mono">{truncateValidatorAddr(item.actor)}</span>}
                    {when && <span className="vp-act__when">{when}</span>}
                </span>
            </span>
        </>
    )
    return (
        <li className="vp-act__row" data-testid="vp-activity-row">
            {href ? (
                <a className="vp-act__link" href={href} target="_blank" rel="noopener noreferrer">{inner}</a>
            ) : (
                <span className="vp-act__link vp-act__link--static">{inner}</span>
            )}
        </li>
    )
}

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

    // ── Activity tab (P2a): this profile's OWN on-chain txs, by operator address.
    // Hooks must run unconditionally (before the early returns below), so it's
    // declared here; the panel itself only renders once the page has loaded.
    const activity = useAddressActivity(operatorAddress)

    // ── Quests tab (P2b): quest progress is per-connected-user (not readable for
    // an arbitrary address), so it's only shown to the OWNER. We load the viewer's
    // OWN progress (local + backend-authoritative) unconditionally, then gate the
    // display on owner-detection below. Non-owners never see another wallet's data.
    const connectedAddr = ctx?.adena.address ?? ""
    const isAuthed = !!ctx?.auth.isAuthenticated && !!ctx?.auth.token
    const [localQuests, setLocalQuests] = useState<UserQuestState>(() => loadQuestProgress())
    const [backendQuests, setBackendQuests] = useState<UserQuestState | null>(null)

    // Refresh local (optimistic) quest state on any completion in this session.
    useEffect(() => {
        const onComplete = () => setLocalQuests(loadQuestProgress())
        window.addEventListener("quest-completed", onComplete)
        return () => window.removeEventListener("quest-completed", onComplete)
    }, [])

    // Backend XP is authoritative (it's what the leaderboard shows). Fetch it for
    // the CONNECTED wallet only — never for an arbitrary profile address. We don't
    // reset state synchronously on disconnect (that would be a cascading-render
    // setState-in-effect); instead `effectiveBackend` below ignores fetched state
    // unless a wallet is connected, so a previous wallet's data can't leak.
    useEffect(() => {
        if (!connectedAddr) return
        let cancelled = false
        void fetchUserQuests(connectedAddr).then((s) => { if (!cancelled && s) setBackendQuests(s) })
        return () => { cancelled = true }
    }, [connectedAddr])
    // Only trust fetched backend quests while a wallet is connected.
    const effectiveBackend = connectedAddr ? backendQuests : null

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
    // (connectedAddr / isAuthed are computed above, before the early returns, so the
    // quest hooks can run unconditionally.)
    const isOwner = !!connectedAddr && isAuthed && connectedAddr === valoper.operatorAddress
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

    // ── Owner quest view (P2b) — only meaningful when isOwner. Backend XP is
    // authoritative; the completed set is the union (local optimistic + backend),
    // so a just-completed quest shows immediately. Each row carries catalog
    // metadata (title/icon/xp) resolved from the unified registry.
    // Computed inline (not useMemo) because this runs AFTER the early returns
    // above — a conditional hook would violate the Rules of Hooks. The work is
    // trivial (a handful of quest lookups), so memoization buys nothing.
    const ownerXP = (effectiveBackend ?? localQuests).totalXP
    const ownerRank = calculateRank(ownerXP)
    const ownerToNext = xpToNextRank(ownerXP)
    const completedQuestIds = new Set(localQuests.completed.map(c => c.questId))
    if (effectiveBackend) for (const c of effectiveBackend.completed) completedQuestIds.add(c.questId)
    const completedQuestRows = [...completedQuestIds]
        .map(id => getQuestById(id))
        .filter((q): q is NonNullable<ReturnType<typeof getQuestById>> => !!q)
        .sort((a, b) => b.xp - a.xp)
    // "Syncing" when local has completions the backend hasn't recorded yet.
    const questsSyncing = effectiveBackend != null && localQuests.completed.length > effectiveBackend.completed.length

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

            {/* ── Quests (P2b — owner-only; progress is per-connected-wallet) ── */}
            {tab === "Quests" && (
                <div role="tabpanel" id="vp-tab-quests" aria-labelledby="vp-tab-quests-btn" data-testid="vp-tab-quests" className="vp-panel">
                    {isOwner ? (
                        <>
                            <div className="vd-card">
                                <div className="vp-quest-head">
                                    <div className="vp-quest-head__xp">
                                        <span className="vp-quest-head__rank" style={{ color: ownerRank.color }}>
                                            {ownerRank.name}
                                        </span>
                                        <span className="vp-quest-head__total">{ownerXP} XP</span>
                                        {questsSyncing && (
                                            <span className="vp-quest-head__sync" title="Saving your latest progress to the server">
                                                syncing…
                                            </span>
                                        )}
                                    </div>
                                    {ownerToNext > 0 && (
                                        <span className="vp-quest-head__next">
                                            {ownerToNext} XP to {calculateRank(ownerXP + ownerToNext).name}
                                        </span>
                                    )}
                                </div>

                                {completedQuestRows.length > 0 ? (
                                    <div className="vp-quests">
                                        {completedQuestRows.map((q) => (
                                            <div key={q.id} className="vp-quest" data-testid="vp-quest-row">
                                                <span className="vp-quest__icon" aria-hidden="true">{q.icon}</span>
                                                <span className="vp-quest__body">
                                                    <span className="vp-quest__title">{q.title}</span>
                                                    <span className="vp-quest__desc">{q.description}</span>
                                                </span>
                                                <span className="vp-quest__xp">+{q.xp} XP</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="vp-quest-empty">
                                        You haven't completed any quests yet.{" "}
                                        <Link to={np("quests")} className="vp-quest-empty__link">Browse quests →</Link>
                                    </p>
                                )}
                            </div>

                            <div className="vp-quest-foot">
                                <Link to={np("quests")} className="vp-peek__link">Open GnoBuilders →</Link>
                            </div>
                        </>
                    ) : (
                        <div className="vd-card vp-empty">
                            <p>Quest progress is private to the wallet holder.</p>
                            <p className="vp-empty__sub">
                                Quests and XP are tracked per connected wallet, so they're only visible to the
                                person who owns this address. Connect with this wallet to see your own quests, or
                                explore the catalog on the GnoBuilders page.
                            </p>
                            <Link to={np("quests")} className="vp-peek__link" style={{ marginTop: 8 }}>
                                Open GnoBuilders →
                            </Link>
                        </div>
                    )}
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

            {/* ── Activity (P2a — this address's own on-chain txs + gov votes) ── */}
            {tab === "Activity" && (
                <div role="tabpanel" id="vp-tab-activity" aria-labelledby="vp-tab-activity-btn" data-testid="vp-tab-activity" className="vp-panel">
                    {/* On-chain transactions for this operator address, from the indexer. */}
                    {activity.available && (
                        <div className="vd-card">
                            <div className="vd-card__title">On-chain activity</div>

                            {activity.loading && (
                                <ol className="vp-act__list" aria-hidden="true" data-testid="vp-activity-loading">
                                    {[0, 1, 2, 3].map((i) => <li key={i} className="vp-act__row vp-act__row--skeleton" />)}
                                </ol>
                            )}

                            {!activity.loading && activity.error && (
                                <div className="vp-act__state" data-testid="vp-activity-error">
                                    <span>Couldn't reach the indexer.</span>
                                    <button type="button" className="vp-act__retry" onClick={() => activity.refetch()}>
                                        <ArrowClockwise size={13} aria-hidden="true" /> Retry
                                    </button>
                                </div>
                            )}

                            {!activity.loading && !activity.error && activity.items.length === 0 && (
                                <div className="vp-act__state" data-testid="vp-activity-empty">
                                    No recent on-chain activity for this address.
                                </div>
                            )}

                            {!activity.loading && !activity.error && activity.items.length > 0 && (
                                <>
                                    <ol className="vp-act__list" data-testid="vp-activity-list">
                                        {activity.items.map((item) => <ActivityRow key={item.txHash} item={item} />)}
                                    </ol>
                                    <p className="vp-act__note">
                                        Showing recent transactions from the chain indexer (most recent first).
                                    </p>
                                </>
                            )}
                        </div>
                    )}

                    {/* Governance votes — a distinct, gnolove-sourced section. */}
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
                        // Only show the votes empty-state when the indexer feed is unavailable
                        // (otherwise the on-chain card above already carries the empty message).
                        !activity.available && (
                            <div className="vd-card vp-empty">
                                <p>No governance votes recorded for this address yet.</p>
                            </div>
                        )
                    )}
                </div>
            )}
        </div>
    )
}
