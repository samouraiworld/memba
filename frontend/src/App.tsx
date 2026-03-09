import { lazy, Suspense } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { useAdena } from "./hooks/useAdena"
import { Layout } from "./components/layout/Layout"
import { Dashboard } from "./pages/Dashboard"

// ── Landing page (lazy — only for unauthenticated visitors) ──
const Landing = lazy(() => import("./pages/Landing").then(m => ({ default: m.Landing })))

// ── Core multisig pages (small, always needed) ──
import { CreateMultisig } from "./pages/CreateMultisig"
import { ImportMultisig } from "./pages/ImportMultisig"
import { MultisigView } from "./pages/MultisigView"
import { ProposeTransaction } from "./pages/ProposeTransaction"
import { TransactionView } from "./pages/TransactionView"

// ── Token pages (lazy — loaded on /tokens or /create-token) ──
const CreateToken = lazy(() => import("./pages/CreateToken").then(m => ({ default: m.CreateToken })))
const TokenDashboard = lazy(() => import("./pages/TokenDashboard").then(m => ({ default: m.TokenDashboard })))
const TokenView = lazy(() => import("./pages/TokenView").then(m => ({ default: m.TokenView })))

// ── DAO pages (lazy — loaded on /dao/*) ──
const DAOList = lazy(() => import("./pages/DAOList").then(m => ({ default: m.DAOList })))
const DAOHome = lazy(() => import("./pages/DAOHome").then(m => ({ default: m.DAOHome })))
const ProposalView = lazy(() => import("./pages/ProposalView").then(m => ({ default: m.ProposalView })))
const DAOMembers = lazy(() => import("./pages/DAOMembers").then(m => ({ default: m.DAOMembers })))
const ProposeDAO = lazy(() => import("./pages/ProposeDAO").then(m => ({ default: m.ProposeDAO })))
const Treasury = lazy(() => import("./pages/Treasury").then(m => ({ default: m.Treasury })))
const TreasuryProposal = lazy(() => import("./pages/TreasuryProposal").then(m => ({ default: m.TreasuryProposal })))
const CreateDAO = lazy(() => import("./pages/CreateDAO").then(m => ({ default: m.CreateDAO })))

// ── Channels page (lazy — v2.5a) ──
const ChannelsPage = lazy(() => import("./pages/ChannelsPage").then(m => ({ default: m.ChannelsPage })))

// ── Profile page (lazy) ──
const ProfilePage = lazy(() => import("./pages/ProfilePage").then(m => ({ default: m.ProfilePage })))

// ── GitHub OAuth callback (lazy) ──
const GithubCallback = lazy(() => import("./pages/GithubCallback").then(m => ({ default: m.GithubCallback })))

// ── Username resolver (lazy) ──
const UserRedirect = lazy(() => import("./pages/UserRedirect").then(m => ({ default: m.UserRedirect })))
const NotFound = lazy(() => import("./pages/NotFound").then(m => ({ default: m.NotFound })))

// ── Settings page (lazy) ──
const Settings = lazy(() => import("./pages/Settings").then(m => ({ default: m.Settings })))

// ── Directory page (lazy) ──
const Directory = lazy(() => import("./pages/Directory").then(m => ({ default: m.Directory })))

// ── Plugin page (lazy) ──
const PluginPage = lazy(() => import("./pages/PluginPage").then(m => ({ default: m.PluginPage })))

// ── Validators page (lazy) ──
const Validators = lazy(() => import("./pages/Validators"))

// ── Multisig Hub (lazy — v2.7) ──
const MultisigHub = lazy(() => import("./pages/MultisigHub"))

// ── Extensions Hub (lazy — v2.6) ──
const Extensions = lazy(() => import("./pages/Extensions").then(m => ({ default: m.Extensions })))

/** Route-level loading fallback — minimal shimmer while chunk loads. */
function PageLoader() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "32px 0" }}>
      {[1, 2, 3].map(i => (
        <div key={i} className="k-shimmer" style={{ height: 80, borderRadius: 8, background: "#111" }} />
      ))}
    </div>
  )
}

/** Redirects /profile → /profile/{address} when connected, or / when not. */
function ProfileRedirect() {
  const adena = useAdena()
  if (adena.connected && adena.address) {
    return <Navigate to={`/profile/${adena.address}`} replace />
  }
  return <Navigate to="/" replace />
}

/** Redirects / → /dashboard when connected (Home = Dashboard when logged in). */
function HomeRedirect() {
  const adena = useAdena()
  if (adena.connected) {
    return <Navigate to="/dashboard" replace />
  }
  return <Suspense fallback={<PageLoader />}><Landing /></Suspense>
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* Landing page (public) — redirects to /dashboard when connected */}
          <Route path="/" element={<HomeRedirect />} />

          {/* Dashboard (authenticated hub) */}
          <Route path="/dashboard" element={<Dashboard />} />

          {/* Multisig Hub (v2.7 — dedicated wallet management overview) */}
          <Route path="/multisig" element={<Suspense fallback={<PageLoader />}><MultisigHub /></Suspense>} />
          <Route path="/create" element={<CreateMultisig />} />
          <Route path="/import" element={<ImportMultisig />} />
          <Route path="/multisig/:address" element={<MultisigView />} />
          <Route path="/multisig/:address/propose" element={<ProposeTransaction />} />
          <Route path="/tx/:id" element={<TransactionView />} />

          {/* Token routes (lazy chunk) */}
          <Route path="/create-token" element={<Suspense fallback={<PageLoader />}><CreateToken /></Suspense>} />
          <Route path="/tokens" element={<Suspense fallback={<PageLoader />}><TokenDashboard /></Suspense>} />
          <Route path="/tokens/:symbol" element={<Suspense fallback={<PageLoader />}><TokenView /></Suspense>} />

          {/* DAO routes (lazy chunk) */}
          <Route path="/dao" element={<Suspense fallback={<PageLoader />}><DAOList /></Suspense>} />
          <Route path="/dao/create" element={<Suspense fallback={<PageLoader />}><CreateDAO /></Suspense>} />
          <Route path="/dao/:slug" element={<Suspense fallback={<PageLoader />}><DAOHome /></Suspense>} />
          <Route path="/dao/:slug/proposal/:id" element={<Suspense fallback={<PageLoader />}><ProposalView /></Suspense>} />
          <Route path="/dao/:slug/members" element={<Suspense fallback={<PageLoader />}><DAOMembers /></Suspense>} />
          <Route path="/dao/:slug/propose" element={<Suspense fallback={<PageLoader />}><ProposeDAO /></Suspense>} />
          <Route path="/dao/:slug/treasury" element={<Suspense fallback={<PageLoader />}><Treasury /></Suspense>} />
          <Route path="/dao/:slug/treasury/propose" element={<Suspense fallback={<PageLoader />}><TreasuryProposal /></Suspense>} />
          <Route path="/dao/:slug/channels" element={<Suspense fallback={<PageLoader />}><ChannelsPage /></Suspense>} />
          <Route path="/dao/:slug/channels/:channel" element={<Suspense fallback={<PageLoader />}><ChannelsPage /></Suspense>} />
          <Route path="/dao/:slug/plugin/:pluginId" element={<Suspense fallback={<PageLoader />}><PluginPage /></Suspense>} />

          {/* Profile routes (lazy) */}
          <Route path="/profile" element={<ProfileRedirect />} />
          <Route path="/profile/:address" element={<Suspense fallback={<PageLoader />}><ProfilePage /></Suspense>} />

          {/* Settings */}
          <Route path="/settings" element={<Suspense fallback={<PageLoader />}><Settings /></Suspense>} />

          {/* Directory */}
          <Route path="/directory" element={<Suspense fallback={<PageLoader />}><Directory /></Suspense>} />

          {/* Validators (v2.1b) */}
          <Route path="/validators" element={<Suspense fallback={<PageLoader />}><Validators /></Suspense>} />

          {/* Extensions Hub (v2.6) */}
          <Route path="/extensions" element={<Suspense fallback={<PageLoader />}><Extensions /></Suspense>} />

          {/* GitHub OAuth callback (lazy) */}
          <Route path="/github/callback" element={<Suspense fallback={<PageLoader />}><GithubCallback /></Suspense>} />

          {/* Username → profile resolver (lazy) */}
          <Route path="/u/:username" element={<Suspense fallback={<PageLoader />}><UserRedirect /></Suspense>} />

          {/* Catch-all 404 */}
          <Route path="*" element={<Suspense fallback={<PageLoader />}><NotFound /></Suspense>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
