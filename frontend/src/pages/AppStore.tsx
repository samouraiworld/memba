/**
 * AppStore — the curated App Store surface at `/apps` (Wave 9).
 *
 * `/apps` lists live apps (read from `memba_appstore_v1.ListLiveJSON` via ABCI);
 * `/apps/<pkgPath>` shows one app's detail. Read-only: registering an app is a
 * wallet flow (later); this page only reads. Each app cross-links to the Explorer
 * (`/explorer/<pkgPath>`) — "read the contract you're about to use". Behind the
 * SAFETY-gated `VITE_ENABLE_APPSTORE` (the realm's fee path is not yet verified
 * on-chain), so it ships off.
 *
 * @module pages/AppStore
 */

import { Suspense } from "react"
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

function AppGrid() {
    const { networkKey } = useNetwork()
    const { data: apps, isPending, isError } = useQuery({
        queryKey: ["appStore", "live"],
        queryFn: () => fetchLiveApps(0, 30),
        staleTime: 60_000,
        gcTime: 300_000,
        retry: 1,
    })

    return (
        <div className="appstore" data-testid="appstore-root">
            <header className="appstore__head">
                <h1 className="appstore__title">App Store</h1>
                <p className="appstore__sub">Curated dApps on gno.land — read the source before you use them.</p>
            </header>

            {isPending ? (
                <p className="appstore__muted">Loading apps…</p>
            ) : isError ? (
                <p className="appstore__muted">Couldn't reach the App Store realm.</p>
            ) : !apps || apps.length === 0 ? (
                <div className="appstore__empty">
                    <p className="appstore__empty-title">No apps listed yet</p>
                    <p className="appstore__muted">The App Store is opening soon — curated apps will appear here.</p>
                </div>
            ) : (
                <ul className="appstore__grid">
                    {apps.map((app) => (
                        <li key={app.pkgPath}>
                            <AppCard app={app} networkKey={networkKey} />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

function AppCard({ app, networkKey }: { app: AppListing; networkKey: string }) {
    const navigate = useNavigate()
    const rel = app.pkgPath.replace(/^gno\.land\//, "")
    return (
        <div
            className="appcard"
            role="button"
            tabIndex={0}
            onClick={() => navigate(`/${networkKey}/apps/${rel}`)}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") navigate(`/${networkKey}/apps/${rel}`)
            }}
        >
            <div className="appcard__name">{app.name}</div>
            {app.category && <span className="appcard__cat">{app.category}</span>}
            {app.tagline && <p className="appcard__tag">{app.tagline}</p>}
            <code className="appcard__path">{app.pkgPath}</code>
        </div>
    )
}

function AppDetail({ pkgPath }: { pkgPath: string }) {
    const { networkKey } = useNetwork()
    const rel = pkgPath.replace(/^gno\.land\//, "")
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
                <div className="appstore__empty">
                    <p className="appstore__empty-title">App not found</p>
                    <code className="appcard__path">{pkgPath}</code>
                </div>
            ) : (
                <article className="appdetail">
                    <h1 className="appstore__title">{app.name}</h1>
                    {app.tagline && <p className="appstore__sub">{app.tagline}</p>}
                    <div className="appdetail__meta">
                        {app.category && <span className="appcard__cat">{app.category}</span>}
                        <code className="appcard__path">{app.pkgPath}</code>
                    </div>
                    {app.descr && <p className="appdetail__descr">{app.descr}</p>}
                    <div className="appdetail__actions">
                        {app.appURL && <AppLink url={app.appURL} networkKey={networkKey} />}
                        <Link className="appdetail__source" to={`/${networkKey}/explorer/${rel}`}>
                            Read the source in Explorer →
                        </Link>
                    </div>
                </article>
            )}
        </div>
    )
}

// AppLink opens a first-party (Memba-relative "/…") app inline, or a third-party
// URL in a new tab (never an iframe — an embedded app asking to sign looks endorsed).
function AppLink({ url, networkKey }: { url: string; networkKey: string }) {
    if (url.startsWith("/")) {
        return <Link className="appdetail__open" to={`/${networkKey}${url}`}>Open app →</Link>
    }
    if (/^https?:\/\//.test(url)) {
        return (
            <a className="appdetail__open" href={url} target="_blank" rel="noopener noreferrer">
                Open app ↗ <span className="appdetail__ext">(leaves Memba)</span>
            </a>
        )
    }
    return null
}
