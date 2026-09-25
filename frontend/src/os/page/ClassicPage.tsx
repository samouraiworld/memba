/**
 * An existing Memba page inside a Memba OS window (owner note 09-24: no "open
 * in Memba" links; apps without a native window show their current page in
 * the window). The page renders from the shared route table against its own
 * location, with the context Layout gives it, built from the OS session.
 *
 * Navigation stays in Memba OS: links and navigate() calls resolve to the
 * window that owns the target page (the same window follows it, another app
 * opens its window, DAO pages open the native DAO windows), as history
 * entries of their own. A page with no
 * window (a callback, another network) leaves Memba OS as a normal page load.
 *
 * @module os/page/ClassicPage
 */
import { Suspense, useContext, useMemo } from "react"
import { createPath, Outlet, Route, Routes, UNSAFE_NavigationContext, type To } from "react-router-dom"
import { OrgProvider } from "../../contexts/OrgContext"
import { networkRouteChildren } from "../../routes/networkRoutes"
import type { LayoutContext } from "../../types/layout"
import { specForTarget, urlForWindow } from "../shell/windows"
import { osTargetForClassic } from "./classicRoute"

function Loading() {
    return <div className="os-row" role="status"><span className="os-spin" aria-hidden="true" /><span className="os-sub">Loading…</span></div>
}

function WindowOutlet({ layout }: { layout: LayoutContext }) {
    return (
        <OrgProvider>
            <Suspense fallback={<Loading />}>
                <Outlet context={layout} />
            </Suspense>
        </OrgProvider>
    )
}

const pathOf = (to: To) => (typeof to === "string" ? to : createPath(to))

export function ClassicPage({ network, page, query, layout }: {
    network: string
    /** The classic page, relative to /:network ("" is the home page). */
    page: string
    /** The page's query string (no "?"), read by useSearchParams inside the page. */
    query?: string
    layout: LayoutContext
}) {
    const parent = useContext(UNSAFE_NavigationContext)
    const nav = useMemo(() => {
        const specFor = (to: To) => {
            const t = osTargetForClassic(pathOf(to), network)
            // A page link is the whole address: no query means the page has none (never "keep the old one").
            return t ? specForTarget(t.kind === "app" ? { ...t, query: t.query ?? "" } : t) : null
        }
        // A classic dashboard or home link has no window of its own: it goes to the desktop itself.
        const isDesktop = (to: To) => osTargetForClassic(pathOf(to), network)?.kind === "desktop"
        // Through the real router, so an in-page link is a history entry (Back returns
        // to the previous page); the shell's URL reader then opens or retargets the window.
        const go = (replace: boolean) => (to: To, state?: unknown) => {
            if (isDesktop(to)) {
                if (replace) parent.navigator.replace("/os", state)
                else parent.navigator.push("/os", state)
                return
            }
            const spec = specFor(to)
            if (!spec) { window.location.assign(pathOf(to)); return }
            if (replace) parent.navigator.replace(urlForWindow(spec), state)
            else parent.navigator.push(urlForWindow(spec), state)
        }
        return {
            ...parent,
            navigator: {
                ...parent.navigator,
                // Links show (and copy) the Memba OS address of their window.
                createHref: (to: To) => {
                    if (isDesktop(to)) return "/os"
                    const spec = specFor(to)
                    return spec ? urlForWindow(spec) : parent.navigator.createHref(to)
                },
                push: go(false),
                replace: go(true),
                go: (n: number) => window.history.go(n),
            },
        }
    }, [parent, network])

    return (
        <div className="os-classic">
            <UNSAFE_NavigationContext.Provider value={nav}>
                <Routes location={{ pathname: `/${network}/${page}`, search: query ? `?${query}` : "" }}>
                    <Route path="/:network" element={<WindowOutlet layout={layout} />}>{networkRouteChildren()}</Route>
                </Routes>
            </UNSAFE_NavigationContext.Provider>
        </div>
    )
}
