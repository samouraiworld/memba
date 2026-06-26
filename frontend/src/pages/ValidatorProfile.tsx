/** ValidatorProfile — the single, canonical validator profile at
 *  /:network/validators/:address. It unifies what used to be two pages:
 *    - the performance/technical page (keyed by signing/consensus address), and
 *    - the valoper "Blend" identity page (keyed by operator address).
 *
 *  An incoming :address is resolved (resolveValidatorProfile) into one of three
 *  identity cases — registered-active, registered-candidate, genesis — or not-found,
 *  and the page composes:
 *    - an identity header (valoper record + hybrid gnolove profile, or a minimal
 *      header for a genesis validator with no valoper record);
 *    - tabs: Overview · Performance · Quests · Contributions · Activity;
 *    - a persistent Community-reviews section below the tabs (not a tab).
 *
 *  A signing-address deep link of a registered valoper redirects to its operator
 *  address (the canonical identity); the legacy /validators/valoper/:x route also
 *  redirects here. */
import { useCallback, useEffect, useRef, useState } from "react"
import { Link, Navigate, useLocation, useOutletContext, useParams } from "react-router-dom"
import {
    Copy, CheckCircle, GlobeSimple, GithubLogo, XLogo, PencilSimple,
    Coins, Package, Scales, ShieldCheck, ArrowsLeftRight, Play, Cube, ArrowClockwise,
} from "@phosphor-icons/react"
import { GNO_RPC_URL, GNO_CHAIN_ID, GNOLOVE_API_URL, getExplorerBaseUrl, isReviewsEnabled } from "../lib/config"
import { ReviewsSection } from "../components/reviews/ReviewsSection"
import {
    fetchValopers,
    resolveValidatorProfile,
    type ValidatorProfileResolution,
} from "../lib/valopers"
import {
    getValidators, truncateValidatorAddr,
    fetchValoperMonikers, mergeValoperMonikers, mergeWithMonitoringData,
} from "../lib/validators"
import { fetchAllMonitoringData } from "../lib/gnomonitoring"
import { ConnectingLoader } from "../components/ui/ConnectingLoader"
import { fetchUserProfile, type UserProfile } from "../lib/profile"
import { resolveAvatarUrl } from "../lib/ipfs"
import { renderMarkdown } from "../lib/markdownLite"
import DOMPurify from "dompurify"
import { resolveValidatorIdentity } from "../lib/validatorIdentity"
import { useGnoloveContributor } from "../hooks/gnolove"
import { useGnoloveTeam } from "../hooks/gnolove/useGnoloveTeams"
import { useNetworkPath } from "../hooks/useNetworkNav"
import { useAddressActivity } from "../hooks/useAddressActivity"
import { formatActivityTime, type ActivityItem, type ActivityKind } from "../lib/activity"
import { loadQuestProgress, fetchUserQuests, completeQuest, trackPageVisit, type UserQuestState } from "../lib/quests"
import { getQuestById, calculateRank, xpToNextRank } from "../lib/gnobuilders"
import { ValoperEditDialog } from "../components/validators/ValoperEditDialog"
import { ValidatorPerformancePanel } from "../components/validators/ValidatorPerformancePanel"
import type { LayoutContext } from "../types/layout"
import "../components/validators/hacker-mode.css"
import "./validator-detail.css"
import "./valoper-detail.css"

const KIND_ICON: Record<ActivityKind, typeof Coins> = {
    token: Coins, deploy: Package, governance: Scales, validator: ShieldCheck,
    transfer: ArrowsLeftRight, run: Play, call: Cube,
}

function activityHref(item: ActivityItem): string | null {
    if (!item.pkgPath) return null
    return `${getExplorerBaseUrl()}${item.pkgPath.replace(/^gno\.land/, "")}`
}

function ActivityRow({ item }: { item: ActivityItem }) {
    const Icon = KIND_ICON[item.kind] ?? Cube
    const href = activityHref(item)
    const when = formatActivityTime(item.time)
    const inner = (
        <>
            <span className={`vp-act__icon vp-act__icon--${item.kind}`} aria-hidden="true"><Icon size={15} weight="bold" /></span>
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
            {href
                ? <a className="vp-act__link" href={href} target="_blank" rel="noopener noreferrer">{inner}</a>
                : <span className="vp-act__link vp-act__link--static">{inner}</span>}
        </li>
    )
}

const SERVER_TYPE_LABEL: Record<string, string> = { "cloud": "Cloud", "on-prem": "On-prem", "data-center": "Data center" }

const TABS = ["Overview", "Quests", "Contributions", "Activity"] as const
type TabKey = (typeof TABS)[number]

function CopyBtn({ text }: { text: string }) {
    const [copied, setCopied] = useState(false)
    return (
        <button className="vd-copy" title="Copy to clipboard" aria-label="Copy"
            onClick={() => { navigator.clipboard.writeText(text).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1400) }}>
            {copied ? <CheckCircle size={13} weight="fill" /> : <Copy size={13} />}
        </button>
    )
}

function AddrRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
    if (!value) return null
    return (
        <div className="vd-row">
            <span className="vd-row__label">{label}{hint && <span className="vp-row__hint"> · {hint}</span>}</span>
            <span className="vd-row__value vd-mono">{value}<CopyBtn text={value} /></span>
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

/** Persistent community-reviews section (below the tabs, every profile). The on-chain
 *  reviews realm is a later phase, so this is the honest "launching soon" hero. */
function ReviewsLaunchingSoon() {
    return (
        <section className="vp-reviews" aria-label="Community reviews" data-testid="vp-reviews">
            <div className="vp-review-hero">
                <div className="vp-review-hero__score">
                    <span className="vp-review-hero__stars" aria-hidden="true">★★★★★</span>
                    <span className="vp-review-hero__soon">soon</span>
                </div>
                <div className="vp-review-hero__copy">
                    <h2 className="vp-review-hero__title">Community reviews — launching soon</h2>
                    <p className="vp-review-hero__sub">
                        On-chain ratings and written reviews for this validator will appear here once the
                        reviews realm goes live.
                    </p>
                </div>
            </div>
        </section>
    )
}

export default function ValidatorProfile() {
    const { address } = useParams<{ address: string }>()
    const location = useLocation()
    const np = useNetworkPath()
    const ctx = useOutletContext<LayoutContext | null>()

    const [resolution, setResolution] = useState<ValidatorProfileResolution | null>(null)
    const [genesisMoniker, setGenesisMoniker] = useState<string>("")
    const [profile, setProfile] = useState<UserProfile | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [tab, setTab] = useState<TabKey>("Overview")
    const [avatarError, setAvatarError] = useState(false)
    const [editOpen, setEditOpen] = useState(false)
    const abortRef = useRef<AbortController | null>(null)

    // Activity tab — this profile's own on-chain txs by canonical address (declared
    // before the early returns so the hook order is stable).
    const canonicalForActivity = resolution?.canonicalAddress || address || ""
    const activity = useAddressActivity(canonicalForActivity)

    // Quests tab — per-connected-wallet, owner-only.
    const connectedAddr = ctx?.adena.address ?? ""
    const isAuthed = !!ctx?.auth.isAuthenticated && !!ctx?.auth.token
    const [localQuests, setLocalQuests] = useState<UserQuestState>(() => loadQuestProgress())
    const [backendQuests, setBackendQuests] = useState<UserQuestState | null>(null)

    useEffect(() => {
        const onComplete = () => setLocalQuests(loadQuestProgress())
        window.addEventListener("quest-completed", onComplete)
        return () => window.removeEventListener("quest-completed", onComplete)
    }, [])

    useEffect(() => {
        if (!connectedAddr) return
        let cancelled = false
        void fetchUserQuests(connectedAddr).then((s) => { if (!cancelled && s) setBackendQuests(s) })
        return () => { cancelled = true }
    }, [connectedAddr])
    const effectiveBackend = connectedAddr ? backendQuests : null

    // Curated gnolove identity (team or contributor) behind this validator, so the
    // Contributions tab shows the real gnolove contributions of the team/person — not an
    // empty address-keyed lookup. Hooks run unconditionally (disabled when unmapped).
    const mappedIdentity = resolveValidatorIdentity({
        moniker: resolution?.valoper?.moniker || genesisMoniker,
        addresses: [resolution?.valoper?.operatorAddress, resolution?.valoper?.signingAddress, address],
    })
    const mappedContributor = useGnoloveContributor(mappedIdentity?.kind === "contributor" ? mappedIdentity.login : "")
    const mappedTeam = useGnoloveTeam(mappedIdentity?.kind === "team" ? mappedIdentity.slug : undefined)

    // Visiting a validator profile counts toward the explorer quest.
    useEffect(() => {
        if (address) { completeQuest("view-validator"); trackPageVisit("validator-detail") }
    }, [address])

    const load = useCallback(async () => {
        if (!address) return
        abortRef.current?.abort()
        const ctrl = new AbortController()
        abortRef.current = ctrl
        setError(null)
        try {
            const vals = await getValidators(GNO_RPC_URL)
            if (ctrl.signal.aborted) return
            const activeSet = new Set(vals.map(v => v.gnoAddr))
            const valopers = await fetchValopers(GNO_RPC_URL, activeSet)
            if (ctrl.signal.aborted) return
            const res = resolveValidatorProfile(address, valopers, activeSet)
            setResolution(res)
            // Genesis: borrow the moniker from the consensus set (no valoper record).
            // getValidators returns moniker:"" — enrich (valopers + gnomonitoring) so a
            // genesis validator shows a name where the network exposes one. Best-effort
            // and genesis-only, so the common (registered) path stays cheap.
            if (res.identityCase === "genesis") {
                let mon = vals.find(x => x.gnoAddr === address || x.address === address)?.moniker || ""
                if (!mon) {
                    try {
                        const [valoperMap, monitoringMap] = await Promise.all([
                            fetchValoperMonikers(GNO_RPC_URL),
                            fetchAllMonitoringData(ctrl.signal),
                        ])
                        if (ctrl.signal.aborted) return
                        const enriched = mergeWithMonitoringData(mergeValoperMonikers(vals, valoperMap), monitoringMap)
                        mon = enriched.find(x => x.gnoAddr === address || x.address === address)?.moniker || ""
                    } catch { /* keep empty — falls back to curated identity label / address */ }
                }
                setGenesisMoniker(mon)
            }
            setLoading(false)
            // Hybrid profile (gnolove + on-chain username + backend) for the canonical
            // address — independent + non-blocking (graceful degradation).
            if (res.identityCase !== "not-found") {
                void fetchUserProfile(GNOLOVE_API_URL, res.canonicalAddress)
                    .then((p) => { if (!ctrl.signal.aborted) setProfile(p) })
                    .catch(() => { /* keep null; header falls back to valoper/validator data */ })
            }
        } catch (e) {
            if (!ctrl.signal.aborted) {
                setError(e instanceof Error ? e.message : "Failed to load validator")
                setLoading(false)
            }
        }
    }, [address])

    const refreshProfile = useCallback(async () => {
        const addr = resolution?.canonicalAddress
        if (!addr) return
        try { setProfile(await fetchUserProfile(GNOLOVE_API_URL, addr)) } catch { /* keep previous */ }
    }, [resolution?.canonicalAddress])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        load()
        return () => abortRef.current?.abort()
    }, [load])

    const valoper = resolution?.valoper ?? null
    // Name precedence: valoper record → on-chain genesis moniker → curated gnolove identity
    // label (e.g. a genesis validator we know by team) → truncated address.
    const moniker = valoper?.moniker || genesisMoniker || mappedIdentity?.label || (address ? truncateValidatorAddr(address) : "")

    useEffect(() => {
        document.title = moniker ? `${moniker} — Validator — Memba` : "Validator — Memba"
        return () => { document.title = "Memba" }
    }, [moniker])

    // ── Redirect a signing-address deep link (or the legacy route) to the canonical URL.
    if (resolution?.shouldRedirect) {
        return <Navigate to={np(`validators/${resolution.canonicalAddress}`)} replace state={location.state} />
    }

    if (loading) {
        return (
            <div className="vd-page">
                <div className="vd-nav"><Link to={np("validators")} className="vd-back">← Validators</Link></div>
                <ConnectingLoader message="Loading validator…" minHeight="50vh" />
            </div>
        )
    }

    if (error && !resolution) {
        return (
            <div className="vd-page">
                <div className="vd-nav"><Link to={np("validators")} className="vd-back">← Validators</Link></div>
                <div className="vd-notfound">
                    <span className="vd-notfound__icon">⚠</span>
                    <h2>Failed to load validator</h2>
                    <p className="vd-mono">{error}</p>
                    <button onClick={() => { setError(null); setLoading(true); void load() }} className="vd-btn-back" style={{ marginTop: 12 }}>Retry</button>
                </div>
            </div>
        )
    }

    if (!resolution || resolution.identityCase === "not-found") {
        return (
            <div className="vd-page">
                <div className="vd-nav"><Link to={np("validators")} className="vd-back">← Validators</Link></div>
                <div className="vd-notfound" data-testid="vp-not-found">
                    <span className="vd-notfound__icon">⚠</span>
                    <h2>Validator not found</h2>
                    <p className="vd-mono">{address}</p>
                    <p>No validator or registered operator matches this address on <strong>{GNO_CHAIN_ID}</strong>.</p>
                    <Link to={np("validators")} className="vd-btn-back">← Back to Validators</Link>
                </div>
            </div>
        )
    }

    // ── Identity (compose resolution + valoper + hybrid profile) ──
    const isGenesis = resolution.identityCase === "genesis"
    const isActive = resolution.isActive
    const isOwner = !!valoper && !!connectedAddr && isAuthed && connectedAddr === valoper.operatorAddress
    const avatar = resolveAvatarUrl(profile?.avatarUrl || profile?.githubAvatar || "")
    const showAvatar = !!avatar && !avatarError
    const bio = profile?.bio || profile?.githubBio || valoper?.description || ""
    const social = profile?.socialLinks
    const hasSocial = !!(social && (social.website || social.github || social.twitter))
    const initials = moniker.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "?"
    const gnowebUrl = valoper
        ? `${getExplorerBaseUrl()}/r/gnops/valopers:${valoper.operatorAddress}`
        : `${getExplorerBaseUrl()}/r/gnoland/valopers`

    const onTabKeyDown = (e: React.KeyboardEvent) => {
        const i = TABS.indexOf(tab)
        if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); setTab(TABS[(i + 1) % TABS.length]) }
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); setTab(TABS[(i - 1 + TABS.length) % TABS.length]) }
        else if (e.key === "Home") { e.preventDefault(); setTab(TABS[0]) }
        else if (e.key === "End") { e.preventDefault(); setTab(TABS[TABS.length - 1]) }
    }

    const hasContribs = !!profile && (
        profile.lovePowerScore > 0 || profile.totalCommits > 0 || profile.totalPRs > 0 ||
        profile.totalIssues > 0 || profile.totalReviews > 0 || profile.deployedPackages.length > 0
    )
    const votes = profile?.governanceVotes ?? []

    const ownerXP = (effectiveBackend ?? localQuests).totalXP
    const ownerRank = calculateRank(ownerXP)
    const ownerToNext = xpToNextRank(ownerXP)
    const completedQuestIds = new Set(localQuests.completed.map(c => c.questId))
    if (effectiveBackend) for (const c of effectiveBackend.completed) completedQuestIds.add(c.questId)
    const completedQuestRows = [...completedQuestIds]
        .map(id => getQuestById(id))
        .filter((q): q is NonNullable<ReturnType<typeof getQuestById>> => !!q)
        .sort((a, b) => b.xp - a.xp)
    const questsSyncing = effectiveBackend != null && localQuests.completed.length > effectiveBackend.completed.length

    return (
        <div className="vd-page" data-testid="validator-profile-page" data-identity-case={resolution.identityCase}>
            <div className="vd-nav">
                <Link to={np("validators")} className="vd-back">← Validators</Link>
                <span className="vd-nav__sep">/</span>
                <span className="vd-nav__current">{moniker}</span>
                <span className="vd-nav__chain">{GNO_CHAIN_ID}</span>
            </div>

            {/* ── Identity header ── */}
            <header className="vp-id">
                <div className="vp-id__avatar" aria-hidden={showAvatar ? undefined : "true"}>
                    {showAvatar
                        ? <img src={avatar} alt={moniker} referrerPolicy="no-referrer" onError={() => setAvatarError(true)} />
                        : <span className="vp-id__initials" data-testid="vp-avatar-fallback">{initials}</span>}
                </div>

                <div className="vp-id__main">
                    <div className="vp-id__namerow">
                        <h1 className="vd-moniker">{moniker}</h1>
                        <span className={`vd-badge ${isActive ? "vd-badge--active" : "vp-badge--candidate"}`}>
                            {isActive ? "● Active" : "○ Candidate"}
                        </span>
                        {valoper?.serverType && (
                            <span className="vp-server">{SERVER_TYPE_LABEL[valoper.serverType] ?? valoper.serverType}</span>
                        )}
                    </div>

                    {profile?.username && (
                        <div className="vp-id__userrow">
                            {profile.userRealmUrl
                                ? <a href={profile.userRealmUrl} target="_blank" rel="noopener noreferrer" className="vp-id__username">{profile.username}</a>
                                : <span className="vp-id__username">{profile.username}</span>}
                        </div>
                    )}

                    {bio && (
                        <div
                            className="vp-id__bio vp-id__bio--md"
                            data-testid="vp-bio"
                            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(bio)) }}
                        />
                    )}

                    {hasSocial && (
                        <div className="vp-id__socials">
                            {social!.website && <a href={social!.website} target="_blank" rel="noopener noreferrer" className="vp-soc" aria-label="Website" title="Website"><GlobeSimple size={16} /></a>}
                            {social!.github && <a href={social!.github.startsWith("http") ? social!.github : `https://github.com/${social!.github}`} target="_blank" rel="noopener noreferrer" className="vp-soc" aria-label="GitHub" title="GitHub"><GithubLogo size={16} /></a>}
                            {social!.twitter && <a href={`https://x.com/${social!.twitter.replace("@", "")}`} target="_blank" rel="noopener noreferrer" className="vp-soc" aria-label="Twitter / X" title="Twitter / X"><XLogo size={16} /></a>}
                        </div>
                    )}

                    <div className="vp-id__addrs">
                        {valoper && <AddrRow label="Operator address" value={valoper.operatorAddress} hint="stable identity" />}
                        <AddrRow
                            label="Signing address"
                            value={valoper?.signingAddress || (isGenesis ? address || "" : "")}
                            hint="rotatable consensus key"
                        />
                    </div>

                    {isGenesis && (
                        <p className="vp-id__note" data-testid="vp-genesis-note">
                            No valoper profile is registered for this address. It is a validator in the active
                            consensus set; identity details appear here if its operator registers a valoper profile.
                        </p>
                    )}
                </div>

                {isOwner && (
                    <div className="vp-id__actions">
                        <button type="button" className="vp-edit-btn vp-edit-btn--enabled" onClick={() => setEditOpen(true)} title="Edit your profile">
                            <PencilSimple size={14} /> Edit profile
                        </button>
                    </div>
                )}
            </header>

            {isOwner && valoper && profile && ctx?.auth.token && (
                <ValoperEditDialog open={editOpen} onClose={() => setEditOpen(false)} profile={profile} token={ctx.auth.token}
                    onSaved={() => { setEditOpen(false); void refreshProfile() }} />
            )}

            {/* ── Tabs ── */}
            <div className="vp-tabs" role="tablist" aria-label="Profile sections">
                {TABS.map((t) => (
                    <button key={t} role="tab" id={`vp-tab-${t.toLowerCase()}-btn`} aria-selected={tab === t}
                        aria-controls={`vp-tab-${t.toLowerCase()}`} tabIndex={tab === t ? 0 : -1}
                        className={`vp-tab${tab === t ? " vp-tab--active" : ""}`} onClick={() => setTab(t)} onKeyDown={onTabKeyDown}>
                        {t}
                    </button>
                ))}
            </div>

            {/* ── Overview ── */}
            {tab === "Overview" && (
                <div role="tabpanel" id="vp-tab-overview" aria-labelledby="vp-tab-overview-btn" data-testid="vp-tab-overview" className="vp-panel">
                    {/* Identity first (the signing pubkey + the operator/signing model). */}
                    {valoper && (
                        <div className="vd-card">
                            <div className="vd-card__title">Identity</div>
                            <AddrRow label="Signing pubkey" value={valoper.signingPubKey} />
                            <p className="vp-identity-note">
                                The <strong>operator address</strong> is the valoper's permanent identity; the{" "}
                                <strong>signing address</strong> is the consensus key it currently validates with, and can
                                rotate without changing identity.
                            </p>
                        </div>
                    )}

                    {/* Live performance metrics, surfaced by default (was an isolated tab). */}
                    <ValidatorPerformancePanel signingAddress={resolution.performanceAddress} isActive={isActive} />

                    <div className="vp-peek">
                        <button type="button" className="vp-peek__link" onClick={() => setTab("Activity")}>View activity →</button>
                        <a href={gnowebUrl} target="_blank" rel="noopener noreferrer" className="vp-peek__link">View on gnoweb ↗</a>
                    </div>
                </div>
            )}

            {/* ── Quests (owner-only) ── */}
            {tab === "Quests" && (
                <div role="tabpanel" id="vp-tab-quests" aria-labelledby="vp-tab-quests-btn" data-testid="vp-tab-quests" className="vp-panel">
                    {isOwner ? (
                        <>
                            <div className="vd-card">
                                <div className="vp-quest-head">
                                    <div className="vp-quest-head__xp">
                                        <span className="vp-quest-head__rank" style={{ color: ownerRank.color }}>{ownerRank.name}</span>
                                        <span className="vp-quest-head__total">{ownerXP} XP</span>
                                        {questsSyncing && <span className="vp-quest-head__sync" title="Saving your latest progress to the server">syncing…</span>}
                                    </div>
                                    {ownerToNext > 0 && <span className="vp-quest-head__next">{ownerToNext} XP to {calculateRank(ownerXP + ownerToNext).name}</span>}
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
                                        You haven't completed any quests yet. <Link to={np("quests")} className="vp-quest-empty__link">Browse quests →</Link>
                                    </p>
                                )}
                            </div>
                            <div className="vp-quest-foot"><Link to={np("quests")} className="vp-peek__link">Open GnoBuilders →</Link></div>
                        </>
                    ) : (
                        <div className="vd-card vp-empty">
                            <p>Quest progress is private to the wallet holder.</p>
                            <p className="vp-empty__sub">Quests and XP are tracked per connected wallet, so they're only visible to the person who owns this address. Connect with this wallet to see your own quests, or explore the catalog on the GnoBuilders page.</p>
                            <Link to={np("quests")} className="vp-peek__link" style={{ marginTop: 8 }}>Open GnoBuilders →</Link>
                        </div>
                    )}
                </div>
            )}

            {/* ── Contributions ── */}
            {tab === "Contributions" && (
                <div role="tabpanel" id="vp-tab-contributions" aria-labelledby="vp-tab-contributions-btn" data-testid="vp-tab-contributions" className="vp-panel">
                    {/* Curated gnolove identity (the team/person behind this validator). */}
                    {mappedIdentity && (
                        <div className="vd-card" data-testid="vp-mapped-identity">
                            <div className="vd-card__title">
                                {mappedIdentity.kind === "team" ? "Team contributions" : "Contributor"}
                            </div>
                            {mappedIdentity.kind === "contributor" ? (
                                <>
                                    <div className="vp-mapped-head">
                                        {mappedContributor.data?.avatarUrl && (
                                            <img className="vp-mapped-avatar" src={mappedContributor.data.avatarUrl} alt={mappedIdentity.label} referrerPolicy="no-referrer" />
                                        )}
                                        <div>
                                            <div className="vp-mapped-name">{mappedContributor.data?.name || mappedIdentity.label}</div>
                                            <div className="vp-mapped-sub">Contributions tracked as @{mappedIdentity.login} on Gnolove</div>
                                        </div>
                                    </div>
                                    {mappedContributor.data && (
                                        <div className="vd-stats-grid" style={{ marginTop: "0.6rem" }}>
                                            <Stat label="Commits" value={String(mappedContributor.data.totalCommits)} accent />
                                            <Stat label="Pull Requests" value={String(mappedContributor.data.totalPullRequests)} />
                                            <Stat label="Issues" value={String(mappedContributor.data.totalIssues)} />
                                        </div>
                                    )}
                                    <Link to={np(`gnolove/contributor/${mappedIdentity.login}`)} className="vp-peek__link" style={{ marginTop: "0.6rem", display: "inline-block" }}>
                                        View on Gnolove →
                                    </Link>
                                </>
                            ) : (
                                <>
                                    <div className="vp-mapped-name">{mappedTeam?.name || mappedIdentity.label}</div>
                                    <div className="vp-mapped-sub">
                                        {mappedTeam ? `${mappedTeam.members.length} member${mappedTeam.members.length === 1 ? "" : "s"} · ` : ""}
                                        Contributions tracked as the {mappedIdentity.label} team on Gnolove
                                    </div>
                                    <Link to={np(`gnolove/teams/${mappedIdentity.slug}`)} className="vp-peek__link" style={{ marginTop: "0.6rem", display: "inline-block" }}>
                                        View team on Gnolove →
                                    </Link>
                                </>
                            )}
                        </div>
                    )}

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
                                    <div className="vd-card__title">Deployed packages ({profile!.deployedPackages.length})</div>
                                    <div className="vp-pkgs">
                                        {profile!.deployedPackages.slice(0, 20).map((pkg) => (
                                            <a key={pkg.path} href={`${getExplorerBaseUrl()}/${pkg.path}`} target="_blank" rel="noopener noreferrer" className="vp-pkg">
                                                <span className="vp-pkg__path vd-mono">{pkg.path}</span>
                                                <span className="vp-pkg__block">#{pkg.blockHeight}</span>
                                            </a>
                                        ))}
                                        {profile!.deployedPackages.length > 20 && <span className="vp-pkgs__more">+{profile!.deployedPackages.length - 20} more</span>}
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (!mappedIdentity && (
                        <div className="vd-card vp-empty">
                            <p>No gno contributions found for this address.</p>
                            <p className="vp-empty__sub">Contribution stats come from gnolove. If this validator hasn't linked a GitHub identity or has no on-chain activity yet, there's nothing to show.</p>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Activity ── */}
            {tab === "Activity" && (
                <div role="tabpanel" id="vp-tab-activity" aria-labelledby="vp-tab-activity-btn" data-testid="vp-tab-activity" className="vp-panel">
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
                                    <button type="button" className="vp-act__retry" onClick={() => activity.refetch()}><ArrowClockwise size={13} aria-hidden="true" /> Retry</button>
                                </div>
                            )}
                            {!activity.loading && !activity.error && activity.items.length === 0 && (
                                <div className="vp-act__state" data-testid="vp-activity-empty">No recent on-chain activity for this address.</div>
                            )}
                            {!activity.loading && !activity.error && activity.items.length > 0 && (
                                <>
                                    <ol className="vp-act__list" data-testid="vp-activity-list">
                                        {activity.items.map((item) => <ActivityRow key={item.txHash} item={item} />)}
                                    </ol>
                                    <p className="vp-act__note">Showing recent transactions from the chain indexer (most recent first).</p>
                                </>
                            )}
                        </div>
                    )}
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
                        !activity.available && <div className="vd-card vp-empty"><p>No governance votes recorded for this address yet.</p></div>
                    )}
                </div>
            )}

            {/* ── Persistent community reviews (below the tabs) ── */}
            {isReviewsEnabled() && (valoper?.operatorAddress || address) ? (
                <ReviewsSection subject={(valoper?.operatorAddress ?? address)!} />
            ) : (
                <ReviewsLaunchingSoon />
            )}
        </div>
    )
}
