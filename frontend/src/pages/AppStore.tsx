/**
 * AppStore — the curated App Store surface at `/apps` (Wave 9).
 *
 * `/apps` lists live apps (read from `memba_appstore_v2.ListLiveJSON` via ABCI);
 * `/apps/<pkgPath>` shows one app's detail. Read-only: registering an app is a
 * wallet flow (later); this page only reads. Each app cross-links to the Explorer
 * (`/explorer/<pkgPath>`) — "read the contract you're about to use". Behind
 * `VITE_ENABLE_APPSTORE` (de-gated 2026-07-07; memba_appstore_v2 live on test13).
 *
 * The visual identity leans on the one thing a gno.land store has that an app
 * store of opaque binaries never can: every app is a public realm you can read
 * before you run. So the realm path is a first-class element, and apps with no
 * uploaded artwork get a deterministic monogram seeded from that path.
 *
 * @module pages/AppStore
 */

import { Suspense, useState, type CSSProperties } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { useNetwork } from "../hooks/useNetwork"
import { fetchLiveApps, fetchApp, fetchByStatus, fetchAppStoreStats, isSafeRealmPath, isAppStoreV3, type AppListing } from "../lib/appStore"
import { fetchSummary, fetchSummaries, type SubjectSummary } from "../lib/reviews"
import { getIpfsGatewayUrl, isValidCid } from "../lib/ipfs"
import { MEMBA_DAO, isAppReviewsEnabled, isAppStoreSubmitEnabled } from "../lib/config"
import { ReviewsSection } from "../components/reviews/ReviewsSection"
import { ReportAppButton } from "../components/appstore/ReportAppButton"
import { AppReviewStars, MIN_RATED_COUNT } from "../components/reviews/AppReviewStars"
import "./appstore.css"

export function AppStore() {
    const splat = useParams()["*"] || ""
    const pkgPath = splat.startsWith("gno.land/") ? splat : splat ? `gno.land/${splat}` : ""
    if (pkgPath && isSafeRealmPath(pkgPath)) {
        return (
            <Suspense fallback={null}>
                <AppDetail pkgPath={pkgPath} />
            </Suspense>
        )
    }
    return <AppGrid />
}

// ── Deterministic per-app identity ────────────────────────────────
// Apps carry no uploaded icon yet (iconCID empty), so each gets a monogram over
// a gradient seeded by its realm path — stable, unique, and CSP-safe (the colors
// are computed inline, never fetched). FNV-1a keeps it tiny and deterministic.
function hashPath(s: string): number {
    let h = 2166136261 >>> 0
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return h >>> 0
}

function monogramStyle(pkgPath: string): CSSProperties {
    const h = hashPath(pkgPath)
    const hue = h % 360
    const hue2 = (hue + 32 + ((h >> 9) % 56)) % 360
    const angle = 115 + (h % 50)
    return {
        background: `linear-gradient(${angle}deg, hsl(${hue} 66% 46%), hsl(${hue2} 70% 32%))`,
        // White initials read on every seeded gradient in both themes; set here
        // (inline) rather than in CSS so the §13 token grep stays clean.
        color: "#ffffff",
    }
}

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return (name.trim().slice(0, 2) || "?").toUpperCase()
}

function Monogram({ app, size }: { app: AppListing; size: "md" | "lg" }) {
    return (
        <div className={`appmono appmono--${size}`} style={monogramStyle(app.pkgPath)} aria-hidden="true">
            <span>{initials(app.name)}</span>
        </div>
    )
}

// AppIcon prefers publisher-pinned artwork (iconCID → IPFS gateway) and falls back
// to the deterministic monogram when the CID is absent, malformed, or the gateway
// fails — a broken image must never leave a blank square on a card. The CID is
// shape-validated before it becomes a URL.
function AppIcon({ app, size }: { app: AppListing; size: "md" | "lg" }) {
    const [failed, setFailed] = useState(false)
    if (!app.iconCID || !isValidCid(app.iconCID) || failed) {
        return <Monogram app={app} size={size} />
    }
    return (
        <img
            className={`appmono appmono--${size} appicon`}
            src={getIpfsGatewayUrl(app.iconCID)}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
        />
    )
}

function CatChip({ category }: { category: string }) {
    // Facet color is content-driven: money-flavored categories borrow the govdao
    // gold, everything else the house teal. Extend the map as the store grows.
    const gold = /defi|dao|finance|treasury|market|token/i.test(category)
    return <span className={`appchip ${gold ? "appchip--gold" : ""}`}>{category}</span>
}

// OpenApp is the primary CTA. First-party ("/…") apps open inline as a Memba
// route; third-party URLs open in a new tab (never an iframe — an embedded app
// asking to sign looks endorsed). Same trust rule as before, stronger styling.
function OpenApp({ url, networkKey }: { url: string; networkKey: string }) {
    if (url.startsWith("/")) {
        return (
            <Link className="appbtn appbtn--primary" to={`/${networkKey}${url}`}>
                Open app <span aria-hidden="true">→</span>
            </Link>
        )
    }
    if (/^https?:\/\//.test(url)) {
        return (
            <a className="appbtn appbtn--primary" href={url} target="_blank" rel="noopener noreferrer">
                Open app <span aria-hidden="true">↗</span>
                <span className="appbtn__ext">leaves Memba</span>
            </a>
        )
    }
    return null
}

function relPath(pkgPath: string): string {
    return pkgPath.replace(/^gno\.land\//, "")
}

function AppGrid() {
    const { networkKey } = useNetwork()
    const appReviews = isAppReviewsEnabled()
    const { data: apps, isPending, isError } = useQuery({
        queryKey: ["appStore", "live"],
        queryFn: () => fetchLiveApps(0, 30),
        staleTime: 60_000,
        gcTime: 300_000,
        retry: 1,
    })

    // Realm-level counts for the masthead (GetStatsJSON exists on v2 AND v3).
    // Falls back to the fetched window's length when the getter errors.
    const { data: stats } = useQuery({
        queryKey: ["appStore", "stats"],
        queryFn: fetchAppStoreStats,
        staleTime: 60_000,
        gcTime: 300_000,
        retry: 1,
    })

    // One batched, concurrency-capped summaries fetch for every visible card —
    // not a per-card query (plan A.5's realm-side batch getter is the real fix).
    const subjects = (apps ?? []).map((a) => a.pkgPath)
    const { data: summaries } = useQuery({
        queryKey: ["appStore", "summaries", subjects],
        queryFn: () => fetchSummaries(subjects, MEMBA_DAO.appReviewsPath),
        enabled: appReviews && subjects.length > 0,
        staleTime: 60_000,
        gcTime: 300_000,
        retry: 1,
    })

    const featured = apps?.[0]
    const rest = apps?.slice(1) ?? []

    return (
        <div className="appstore" data-testid="appstore-root">
            <header className="appstore__masthead">
                <p className="appstore__eyebrow">Curated on-chain apps</p>
                <h1 className="appstore__headline">
                    Apps you can read<br />before you run them
                </h1>
                <p className="appstore__lede">
                    Every app here is a public gno.land realm. Open its source, verify what it does,
                    then use it — no opaque binaries, no blind trust.
                </p>
                {!isPending && !isError && apps && apps.length > 0 && (
                    <div className="appstore__stats">
                        <span><strong>{stats?.live ?? apps.length}</strong> {(stats?.live ?? apps.length) === 1 ? "app" : "apps"}</span>
                        {stats && stats.total > stats.live && (
                            <>
                                <span className="appstore__dot" aria-hidden="true">·</span>
                                <span><strong>{stats.total}</strong> submitted</span>
                            </>
                        )}
                        <span className="appstore__dot" aria-hidden="true">·</span>
                        <span>on gno.land</span>
                        <span className="appstore__dot" aria-hidden="true">·</span>
                        <span>source-readable</span>
                    </div>
                )}
                {/* Self-service listing (B3) — the submit route only exists meaningfully on the
                    v3 realm, and the flag is SAFETY-GATED until its fee path is verified. */}
                {isAppStoreSubmitEnabled() && isAppStoreV3() && (
                    <Link className="appbtn appbtn--ghost appstore__submit-cta" to={`/${networkKey}/apps/submit`}>
                        Submit your app
                    </Link>
                )}
            </header>

            {isPending ? (
                <ul className="appstore__grid" aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                        <li key={i}><div className="appcard appcard--skeleton" /></li>
                    ))}
                </ul>
            ) : isError ? (
                <div className="appstore__notice">
                    <p className="appstore__notice-title">Couldn't reach the App Store</p>
                    <p className="appstore__muted">The realm didn't respond. Check your network, then reload.</p>
                </div>
            ) : !apps || apps.length === 0 ? (
                <div className="appstore__notice">
                    <p className="appstore__notice-title">No apps listed yet</p>
                    <p className="appstore__muted">Curated apps land here as they're published. Check back soon.</p>
                </div>
            ) : (
                <>
                    {featured && <FeaturedApp app={featured} networkKey={networkKey} summary={summaries?.get(featured.pkgPath)} />}
                    {rest.length > 0 && (
                        <section className="appstore__section">
                            <h2 className="appstore__section-title">All apps</h2>
                            <ul className="appstore__grid">
                                {rest.map((app) => (
                                    <li key={app.pkgPath}>
                                        <AppCard app={app} networkKey={networkKey} summary={summaries?.get(app.pkgPath)} />
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                </>
            )}

            {/* Verified (live) apps are the default view above. On v3, pending-review apps are an
                opt-in disclosure only — never a peer of the verified grid. */}
            {isAppStoreV3() && <PendingReviewSection networkKey={networkKey} />}
        </div>
    )
}

function FeaturedApp({ app, networkKey, summary }: { app: AppListing; networkKey: string; summary?: SubjectSummary }) {
    const rel = relPath(app.pkgPath)
    return (
        <section className="appfeatured" aria-label={`Featured: ${app.name}`}>
            <p className="appfeatured__badge">
                <span className="appfeatured__star" aria-hidden="true">★</span> Featured
            </p>
            <div className="appfeatured__body">
                <AppIcon app={app} size="lg" />
                <div className="appfeatured__content">
                    {app.category && (
                        <div className="appfeatured__cats"><CatChip category={app.category} /></div>
                    )}
                    <h2 className="appfeatured__name">{app.name}</h2>
                    {/* Same integrity rule as the detail hero: only render once there IS a
                        review — zero-review listings get no "No reviews yet" noise on cards. */}
                    {summary && summary.count > 0 && (
                        <AppReviewStars count={summary.count} average={summary.average} className="appfeatured__stars" />
                    )}
                    {app.tagline && <p className="appfeatured__tag">{app.tagline}</p>}
                    {app.descr && <p className="appfeatured__descr">{app.descr}</p>}
                    <div className="appfeatured__actions">
                        {app.appURL && <OpenApp url={app.appURL} networkKey={networkKey} />}
                        <Link className="appbtn appbtn--ghost" to={`/${networkKey}/apps/${rel}`}>
                            Details
                        </Link>
                    </div>
                    <code className="apppath">{app.pkgPath}</code>
                </div>
            </div>
        </section>
    )
}

function AppCard({ app, networkKey, pending, summary }: { app: AppListing; networkKey: string; pending?: boolean; summary?: SubjectSummary }) {
    const navigate = useNavigate()
    const rel = relPath(app.pkgPath)
    const go = () => navigate(`/${networkKey}/apps/${rel}`)
    return (
        <div
            className={`appcard${pending ? " appcard--pending" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={`${app.name}${app.category ? `, ${app.category}` : ""}${pending ? ", pending review" : ""}`}
            onClick={go}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault() // Space on a role=button would also scroll the page
                    go()
                }
            }}
        >
            <div className="appcard__top">
                <AppIcon app={app} size="md" />
                {pending ? <span className="appcard__pending-chip">Pending review</span> : app.category && <CatChip category={app.category} />}
            </div>
            <div className="appcard__name">{app.name}</div>
            {summary && summary.count > 0 && (
                <AppReviewStars count={summary.count} average={summary.average} className="appcard__stars" />
            )}
            {app.tagline && <p className="appcard__tag">{app.tagline}</p>}
            <code className="apppath appcard__path">{app.pkgPath}</code>
        </div>
    )
}

/**
 * Pending-review apps — an OPT-IN, off-by-default disclosure (v3 only). These listings have
 * paid the fee but haven't been vetted by a curator, so they must never sit as a peer of the
 * verified grid; the user has to explicitly ask to see them, and every card is amber-chipped
 * with a caution. Lazily fetched only once expanded.
 */
function PendingReviewSection({ networkKey }: { networkKey: string }) {
    const [open, setOpen] = useState(false)
    const { data: pending, isPending, isError } = useQuery({
        queryKey: ["appStore", "pending"],
        queryFn: () => fetchByStatus("pending", 0, 30),
        enabled: open,
        staleTime: 60_000,
        gcTime: 300_000,
        retry: 1,
    })

    return (
        <section className="appstore__section appstore__pending">
            <button
                type="button"
                className="appstore__pending-toggle"
                aria-expanded={open}
                aria-controls="appstore-pending-list"
                onClick={() => setOpen((v) => !v)}
            >
                <span aria-hidden="true">{open ? "▾" : "▸"}</span> Apps pending review
                <span className="appstore__pending-hint">— not yet vetted by a curator</span>
            </button>

            {open && (
                <div id="appstore-pending-list">
                    {isPending ? (
                        <p className="appstore__muted">Loading…</p>
                    ) : isError ? (
                        <p className="appstore__muted">Couldn't load pending apps. Reload to retry.</p>
                    ) : !pending || pending.length === 0 ? (
                        <p className="appstore__muted">Nothing pending review right now.</p>
                    ) : (
                        <>
                            <p className="appstore__pending-caution" role="note">
                                These apps have been submitted but not reviewed. Treat them with extra
                                caution and read the source before you connect a wallet.
                            </p>
                            <ul className="appstore__grid">
                                {pending.map((app) => (
                                    <li key={app.pkgPath}>
                                        <AppCard app={app} networkKey={networkKey} pending />
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </div>
            )}
        </section>
    )
}

function shortAddr(addr: string): string {
    return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : addr
}

function AppDetail({ pkgPath }: { pkgPath: string }) {
    const { networkKey } = useNetwork()
    const rel = relPath(pkgPath)
    const appReviews = isAppReviewsEnabled()
    const { data: app, isPending, isError } = useQuery({
        queryKey: ["appStore", "detail", pkgPath],
        queryFn: () => fetchApp(pkgPath),
        staleTime: 60_000,
        gcTime: 300_000,
        retry: 1,
    })
    // Compact at-a-glance rating for the hero. The review subject is the app's own realm path.
    // Only fetched when community reviews are enabled (the app-reviews realm is deployed but
    // gated behind VITE_ENABLE_APP_REVIEWS until wired live).
    const { data: reviewSummary } = useQuery({
        queryKey: ["appReviews", "summary", pkgPath],
        queryFn: () => fetchSummary(pkgPath, MEMBA_DAO.appReviewsPath),
        enabled: appReviews,
        staleTime: 60_000,
        gcTime: 300_000,
        retry: 1,
    })

    return (
        <div className="appstore" data-testid="appstore-root">
            <Link className="appstore__back" to={`/${networkKey}/apps`}>← All apps</Link>

            {isPending ? (
                <p className="appstore__muted">Loading…</p>
            ) : isError || !app ? (
                <div className="appstore__notice">
                    <p className="appstore__notice-title">App not found</p>
                    <code className="apppath">{pkgPath}</code>
                </div>
            ) : (
                <article className="appdetail">
                    {/* An unvetted listing must carry its caution onto the detail page too — otherwise
                        a pending app looks identical to a curated one once you click through. */}
                    {app.status === "pending" && (
                        <div className="appdetail__pending-banner" role="note">
                            <strong>Pending review.</strong> This app has been submitted but not yet
                            vetted by a curator. Read its source before you connect a wallet.
                        </div>
                    )}
                    <div className="appdetail__hero">
                        <AppIcon app={app} size="lg" />
                        <div className="appdetail__heroText">
                            {app.category && (
                                <div className="appdetail__cats"><CatChip category={app.category} /></div>
                            )}
                            <h1 className="appdetail__name">{app.name}</h1>
                            {app.tagline && <p className="appdetail__tag">{app.tagline}</p>}
                            {/* Only in the hero once there's at least one review — the section
                                below owns the empty "be the first" affordance, so we don't
                                double up "No reviews yet" on every fresh listing. */}
                            {appReviews && reviewSummary && reviewSummary.count > 0 && (
                                <AppReviewStars
                                    count={reviewSummary.count}
                                    average={reviewSummary.average}
                                    className="appdetail__stars"
                                />
                            )}
                            <code className="apppath">{app.pkgPath}</code>
                        </div>
                    </div>

                    {app.descr && <p className="appdetail__descr">{app.descr}</p>}

                    <div className="appdetail__actions">
                        {app.appURL && <OpenApp url={app.appURL} networkKey={networkKey} />}
                        <Link className="appbtn appbtn--ghost" to={`/${networkKey}/directory?tab=explorer&realm=${rel}`}>
                            Read the source <span aria-hidden="true">→</span>
                        </Link>
                    </div>

                    <aside className="apptrust">
                        <p className="apptrust__title">Read before you run</p>
                        <p className="apptrust__body">
                            This is an on-chain realm. Its full source is public — read it in the
                            Explorer before you connect a wallet.
                            {app.publisher && (
                                <> Published by <code className="apptrust__addr">{shortAddr(app.publisher)}</code>.</>
                            )}
                        </p>
                        {/* Community safety valve (B1b): flaggable states only — the realm
                            rejects flags on rejected/delisted apps anyway. */}
                        {(app.status === "live" || app.status === "pending") && (
                            <ReportAppButton pkgPath={app.pkgPath} />
                        )}
                    </aside>

                    {appReviews && (
                        <div className="appdetail__reviews">
                            <ReviewsSection
                                subject={pkgPath}
                                realmPath={MEMBA_DAO.appReviewsPath}
                                minRatedCount={MIN_RATED_COUNT}
                            />
                        </div>
                    )}
                </article>
            )}
        </div>
    )
}
