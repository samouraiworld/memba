import { lazy, Suspense } from "react"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { Layout } from "./components/layout/Layout"
import { Dashboard } from "./pages/Dashboard"

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

// ── Profile page (lazy) ──
const ProfilePage = lazy(() => import("./pages/ProfilePage").then(m => ({ default: m.ProfilePage })))

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

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* Core multisig routes (bundled with main chunk) */}
          <Route path="/" element={<Dashboard />} />
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

          {/* Profile route (lazy) */}
          <Route path="/profile/:address" element={<Suspense fallback={<PageLoader />}><ProfilePage /></Suspense>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
