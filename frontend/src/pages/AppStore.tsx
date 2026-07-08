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

import { Suspense, type CSSProperties } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { useNetwork } from "../hooks/useNetwork"
import { fetchLiveApps, fetchApp, isSafeRealmPath, type AppListing } from "../lib/appStore"
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
    const { data: apps, isPending, isError } = useQuery({
        queryKey: ["appStore", "live"],
        queryFn: () => fetchLiveApps(0, 30),
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
                        <span><strong>{apps.length}</strong> {apps.length === 1 ? "app" : "apps"}</span>
                        <span className="appstore__dot" aria-hidden="true">·</span>
                        <span>on gno.land</span>
                        <span className="appstore__dot" aria-hidden="true">·</span>
                        <span>source-readable</span>
                    </div>
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
                    {featured && <FeaturedApp app={featured} networkKey={networkKey} />}
                    {rest.length > 0 && (
                        <section className="appstore__section">
                            <h2 className="appstore__section-title">All apps</h2>
                            <ul className="appstore__grid">
                                {rest.map((app) => (
                                    <li key={app.pkgPath}>
                                        <AppCard app={app} networkKey={networkKey} />
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                </>
            )}
        </div>
    )
}

function FeaturedApp({ app, networkKey }: { app: AppListing; networkKey: string }) {
    const rel = relPath(app.pkgPath)
    return (
        <section className="appfeatured" aria-label={`Featured: ${app.name}`}>
            <p className="appfeatured__badge">
                <span className="appfeatured__star" aria-hidden="true">★</span> Featured
            </p>
            <div className="appfeatured__body">
                <Monogram app={app} size="lg" />
                <div className="appfeatured__content">
                    {app.category && (
                        <div className="appfeatured__cats"><CatChip category={app.category} /></div>
                    )}
                    <h2 className="appfeatured__name">{app.name}</h2>
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

function AppCard({ app, networkKey }: { app: AppListing; networkKey: string }) {
    const navigate = useNavigate()
    const rel = relPath(app.pkgPath)
    const go = () => navigate(`/${networkKey}/apps/${rel}`)
    return (
        <div
            className="appcard"
            role="button"
            tabIndex={0}
            aria-label={`${app.name}${app.category ? `, ${app.category}` : ""}`}
            onClick={go}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault() // Space on a role=button would also scroll the page
                    go()
                }
            }}
        >
            <div className="appcard__top">
                <Monogram app={app} size="md" />
                {app.category && <CatChip category={app.category} />}
            </div>
            <div className="appcard__name">{app.name}</div>
            {app.tagline && <p className="appcard__tag">{app.tagline}</p>}
            <code className="apppath appcard__path">{app.pkgPath}</code>
        </div>
    )
}

function shortAddr(addr: string): string {
    return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : addr
}

function AppDetail({ pkgPath }: { pkgPath: string }) {
    const { networkKey } = useNetwork()
    const rel = relPath(pkgPath)
    const { data: app, isPending, isError } = useQuery({
        queryKey: ["appStore", "detail", pkgPath],
        queryFn: () => fetchApp(pkgPath),
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
                    <div className="appdetail__hero">
                        <Monogram app={app} size="lg" />
                        <div className="appdetail__heroText">
                            {app.category && (
                                <div className="appdetail__cats"><CatChip category={app.category} /></div>
                            )}
                            <h1 className="appdetail__name">{app.name}</h1>
                            {app.tagline && <p className="appdetail__tag">{app.tagline}</p>}
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
                    </aside>
                </article>
            )}
        </div>
    )
}
