/**
 * GnoloveLayout — Section-scoped layout.
 *
 * The QueryClient/persistence are now provided app-wide via main.tsx
 * (see lib/queryClient.ts — Task 0.2). GnoloveLayout simply renders
 * into the existing root provider; gnolove queries remain prefixed
 * ["gnolove", …] so persistence filtering is unchanged.
 *
 * ErrorBoundary ensures gnolove failures don't crash the entire Memba app.
 * Inner Suspense prevents SubNav disappearing during child route transitions.
 *
 * @module layouts/GnoloveLayout
 */

import { Suspense } from "react"
import { Outlet } from "react-router-dom"
import GnoloveSubNav from "../components/gnolove/GnoloveSubNav"
import { GnoloveErrorBoundary } from "../components/gnolove/GnoloveErrorBoundary"
import { useFocusOnRouteChange } from "../hooks/useFocusOnRouteChange"
import "../pages/gnolove/gnolove.css"

// ── Section Loader ───────────────────────────────────────────

function GnolovePageLoader() {
    return (
        <div className="gl-loading">
            <div className="gl-skeleton" />
            <div className="gl-skeleton" />
            <div className="gl-skeleton" />
        </div>
    )
}

// ── Layout ───────────────────────────────────────────────────

export default function GnoloveLayout() {
    useFocusOnRouteChange()

    return (
        <div className="gl-layout">
            <GnoloveSubNav />
            <GnoloveErrorBoundary name="Gnolove">
                <Suspense fallback={<GnolovePageLoader />}>
                    <Outlet />
                </Suspense>
            </GnoloveErrorBoundary>
        </div>
    )
}
