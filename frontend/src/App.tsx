import { lazy, Suspense, useEffect, type ReactNode } from "react"
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom"
import { ScrollToTop } from "./components/layout/ScrollToTop"
import { NetworkGate } from "./components/layout/NetworkGate"
import { RootRedirect } from "./components/layout/RootRedirect"
import { OS_ENABLED } from "./os/flag"
import { networkRouteChildren } from "./routes/networkRoutes"

// ── Memba OS (behind VITE_MEMBA_OS; its own shell, outside the network Layout) ──
// The import sits behind the flag so a flag-off build drops the chunk entirely:
// otherwise it would still be emitted and precached by the service worker.
const OsRoot = OS_ENABLED ? lazy(() => import("./os/OsRoot")) : null

/** Every /os URL belongs to Memba OS. Decided before route matching: as an
 *  "/os/*" route, deeper classic routes outrank it (/:network/dao/*
 *  scores higher than /os/*), so /os/dao/… would fall into the network
 *  routes as network "os". With the flag off, /os stays a network path as before. */
function OsOrClassic({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  // Builds with Memba OS on (the memba.club beta site only) open it at the root too.
  if (OsRoot && pathname === "/") return <Navigate to="/os" replace />
  if (OsRoot && (pathname === "/os" || pathname.startsWith("/os/"))) {
    return <Suspense fallback={null}><OsRoot /></Suspense>
  }
  return children
}

function App() {
  // Prefetch critical routes in the background after initial render
  // to achieve instant navigation without exceeding the main chunk size budget.
  useEffect(() => {
    const prefetch = async () => {
      try {
        await Promise.all([
          import("./pages/ProfilePage"),
          import("./pages/UnifiedMarketplace"),
          import("./pages/DAOList"),
          import("./pages/TokenDashboard")
        ])
      } catch (e) {
        console.debug("Prefetching failed:", e)
      }
    }
    // Delay prefetching to ensure main thread is free
    setTimeout(prefetch, 1000)
  }, [])

  return (
    <BrowserRouter>
      <ScrollToTop />
      <OsOrClassic>
      <Routes>
        {/* Root → redirect to /:defaultNetwork/ */}
        <Route path="/" element={<RootRedirect />} />

        {/* ── Network-scoped routes ─────────────────────────── */}
        <Route path="/:network" element={<NetworkGate />}>
          {networkRouteChildren()}
        </Route>
      </Routes>
      </OsOrClassic>
    </BrowserRouter>
  )
}

export default App
