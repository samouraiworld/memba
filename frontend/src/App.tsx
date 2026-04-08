import { lazy, Suspense } from "react"
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom"
import { useAdena } from "./hooks/useAdena"
import { useNetworkKey } from "./hooks/useNetworkNav"
import { Layout } from "./components/layout/Layout"
import { ScrollToTop } from "./components/layout/ScrollToTop"
import { NetworkSync } from "./components/layout/NetworkSync"
import { LegacyRedirect } from "./components/layout/LegacyRedirect"
import { ConnectingLoader } from "./components/ui/ConnectingLoader"
import { NETWORKS, DEFAULT_NETWORK } from "./lib/config"
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
const CreateDAO = lazy(() => import("./pages/CreateDAO").then(m => ({ default: m.CreateDAO })))
import { DAORouter } from "./components/dao/DAORouter"

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

// ── Validators pages (lazy) — ORDER MATTERS: /hacker before /:address ──
// CRITICAL: /validators/hacker must be declared before /validators/:address,
// otherwise React Router will match the literal string "hacker" as an :address param.
const Validators = lazy(() => import("./pages/Validators"))
const ValidatorsHacker = lazy(() => import("./pages/ValidatorsHacker"))
const ValidatorDetail = lazy(() => import("./pages/ValidatorDetail"))

// ── Multisig Hub (lazy — v2.7) ──
const MultisigHub = lazy(() => import("./pages/MultisigHub"))

// ── Extensions Hub (lazy — v2.6) ──
const Extensions = lazy(() => import("./pages/Extensions").then(m => ({ default: m.Extensions })))

// ── Feedback page (lazy — v2.10) ──
const FeedbackPage = lazy(() => import("./pages/FeedbackPage"))
const QuestHub = lazy(() => import("./pages/QuestHub"))
const QuestDetail = lazy(() => import("./pages/QuestDetail"))
const Leaderboard = lazy(() => import("./pages/Leaderboard"))

// ── Alerts page (lazy — v2.18.0) ──
const AlertsPage = lazy(() => import("./pages/AlertsPage"))

// ── Organizations page (lazy — v2.22.0) ──
const OrganizationsPage = lazy(() => import("./pages/OrganizationsPage"))

// ── Gnolove section (lazy — v2.19.0) ──
const GnoloveLayout = lazy(() => import("./layouts/GnoloveLayout"))
const GnoloveHome = lazy(() => import("./pages/gnolove/GnoloveHome"))
const GnoloveReport = lazy(() => import("./pages/gnolove/GnoloveReport"))
const GnoloveAnalytics = lazy(() => import("./pages/gnolove/GnoloveAnalytics"))
const GnoloveContributorProfile = lazy(() => import("./pages/gnolove/GnoloveContributorProfile"))
const GnoloveTeams = lazy(() => import("./pages/gnolove/GnoloveTeams"))
const GnoloveTeamProfile = lazy(() => import("./pages/gnolove/GnoloveTeamProfile"))
const GnoloveAIReports = lazy(() => import("./pages/gnolove/GnoloveAIReports"))
const GnoloveMilestone = lazy(() => import("./pages/gnolove/GnoloveMilestone"))

// ── NFT Gallery (lazy — v3.0) ──
const NFTGallery = lazy(() => import("./pages/NFTGallery").then(m => ({ default: m.NFTGallery })))
const NFTCollectionView = lazy(() => import("./pages/NFTGallery").then(m => ({ default: m.NFTCollectionView })))
const NFTLaunchpad = lazy(() => import("./pages/NFTLaunchpad"))

// ── AI Agent Marketplace (lazy — v3.0) ──
const Marketplace = lazy(() => import("./pages/Marketplace"))

// ── Freelance Services (lazy — v3.0) ──
const FreelanceServices = lazy(() => import("./pages/FreelanceServices"))

// ── Candidature page (lazy — v2.28) ──
const CandidaturePage = lazy(() => import("./pages/CandidaturePage"))

// ── Changelogs page (lazy — v2.14) ──
const Changelogs = lazy(() => import("./pages/Changelogs"))

/** Route-level loading fallback — unified Memba logo loader (v2.10). */
function PageLoader() {
  return <ConnectingLoader message="Loading..." minHeight="30vh" />
}

/** Redirects /:network/profile → /:network/profile/{address} when connected. */
function ProfileRedirect() {
  const adena = useAdena()
  const networkKey = useNetworkKey()
  if (adena.connected && adena.address) {
    return <Navigate to={`/${networkKey}/profile/${adena.address}`} replace />
  }
  return <Navigate to={`/${networkKey}/`} replace />
}

/** Redirects /:network/ → /:network/dashboard when connected, shows Landing when not. */
function HomeRedirect() {
  const adena = useAdena()
  const networkKey = useNetworkKey()
  if (adena.connected) {
    return <Navigate to={`/${networkKey}/dashboard`} replace />
  }
  return <Suspense fallback={<PageLoader />}><Landing /></Suspense>
}

/** Redirects bare / to /:defaultNetwork/ */
function RootRedirect() {
  const stored = localStorage.getItem("memba_network")
  const network = (stored && NETWORKS[stored]) ? stored : DEFAULT_NETWORK
  return <Navigate to={`/${network}/`} replace />
}

/** Validates the /:network param. If invalid, treats as legacy URL and redirects. */
function NetworkGate() {
  const { network } = useParams<{ network: string }>()
  if (!network || !NETWORKS[network]) {
    return <LegacyRedirect />
  }
  return (
    <>
      <NetworkSync />
      <Layout />
    </>
  )
}

function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        {/* Root → redirect to /:defaultNetwork/ */}
        <Route path="/" element={<RootRedirect />} />

        {/* ── Network-scoped routes ─────────────────────────── */}
        <Route path="/:network" element={<NetworkGate />}>
          {/* Landing page (public) — redirects to /dashboard when connected */}
          <Route index element={<HomeRedirect />} />

          {/* Dashboard (authenticated hub) */}
          <Route path="dashboard" element={<Dashboard />} />

          {/* Multisig Hub (v2.7 — dedicated wallet management overview) */}
          <Route path="multisig" element={<Suspense fallback={<PageLoader />}><MultisigHub /></Suspense>} />
          <Route path="create" element={<CreateMultisig />} />
          <Route path="import" element={<ImportMultisig />} />
          <Route path="multisig/:address" element={<MultisigView />} />
          <Route path="multisig/:address/propose" element={<ProposeTransaction />} />
          <Route path="tx/:id" element={<TransactionView />} />

          {/* Token routes (lazy chunk) */}
          <Route path="create-token" element={<Suspense fallback={<PageLoader />}><CreateToken /></Suspense>} />
          <Route path="tokens" element={<Suspense fallback={<PageLoader />}><TokenDashboard /></Suspense>} />
          <Route path="tokens/:symbol" element={<Suspense fallback={<PageLoader />}><TokenView /></Suspense>} />

          {/* DAO routes — splat for clean realm paths with real / */}
          <Route path="dao" element={<Suspense fallback={<PageLoader />}><DAOList /></Suspense>} />
          <Route path="dao/create" element={<Suspense fallback={<PageLoader />}><CreateDAO /></Suspense>} />
          <Route path="dao/*" element={<DAORouter />} />

          {/* Profile routes (lazy) */}
          <Route path="profile" element={<ProfileRedirect />} />
          <Route path="profile/:address" element={<Suspense fallback={<PageLoader />}><ProfilePage /></Suspense>} />

          {/* Settings */}
          <Route path="settings" element={<Suspense fallback={<PageLoader />}><Settings /></Suspense>} />

          {/* Directory */}
          <Route path="directory" element={<Suspense fallback={<PageLoader />}><Directory /></Suspense>} />

          {/* Validators suite (v2.14) — order: /validators, /validators/hacker, /validators/:address */}
          <Route path="validators" element={<Suspense fallback={<PageLoader />}><Validators /></Suspense>} />
          {/* CRITICAL: /validators/hacker must come BEFORE /validators/:address */}
          <Route path="validators/hacker" element={<Suspense fallback={<PageLoader />}><ValidatorsHacker /></Suspense>} />
          <Route path="validators/:address" element={<Suspense fallback={<PageLoader />}><ValidatorDetail /></Suspense>} />

          {/* NFT section (v3.0 gallery, v3.1 launchpad) — ORDER MATTERS: /nft/create before /nft/:realmPath */}
          <Route path="nft" element={<Suspense fallback={<PageLoader />}><NFTGallery /></Suspense>} />
          <Route path="nft/create" element={<Suspense fallback={<PageLoader />}><NFTLaunchpad /></Suspense>} />
          <Route path="nft/:realmPath" element={<Suspense fallback={<PageLoader />}><NFTCollectionView /></Suspense>} />

          {/* Freelance Services (v3.0) */}
          <Route path="services" element={<Suspense fallback={<PageLoader />}><FreelanceServices /></Suspense>} />

          {/* Extensions Hub (v2.6) */}
          <Route path="extensions" element={<Suspense fallback={<PageLoader />}><Extensions /></Suspense>} />

          {/* AI Agent Marketplace (v3.0) */}
          <Route path="marketplace" element={<Suspense fallback={<PageLoader />}><Marketplace /></Suspense>} />

          {/* Alerts — Professional alerting (v2.18.0) */}
          <Route path="alerts" element={<Suspense fallback={<PageLoader />}><AlertsPage /></Suspense>} />

          {/* Organizations — Team management (v2.22.0) */}
          <Route path="organizations" element={<Suspense fallback={<PageLoader />}><OrganizationsPage /></Suspense>} />

          {/* Gnolove — Contributor scoreboard & analytics (v2.19.0) */}
          <Route path="gnolove" element={<Suspense fallback={<PageLoader />}><GnoloveLayout /></Suspense>}>
            <Route index element={<GnoloveHome />} />
            <Route path="report" element={<GnoloveReport />} />
            <Route path="analytics" element={<GnoloveAnalytics />} />
            <Route path="contributor/:login" element={<GnoloveContributorProfile />} />
            <Route path="teams" element={<GnoloveTeams />} />
            <Route path="teams/:teamName" element={<GnoloveTeamProfile />} />
            <Route path="reports" element={<GnoloveAIReports />} />
            <Route path="milestone" element={<GnoloveMilestone />} />
          </Route>

          {/* GnoBuilders — Quest catalog and leaderboard (v4.0) */}
          <Route path="quests" element={<Suspense fallback={<PageLoader />}><QuestHub /></Suspense>} />
          <Route path="quests/:questId" element={<Suspense fallback={<PageLoader />}><QuestDetail /></Suspense>} />
          <Route path="leaderboard" element={<Suspense fallback={<PageLoader />}><Leaderboard /></Suspense>} />

          {/* Candidature — Memba DAO membership application (v2.28) */}
          <Route path="candidature" element={<Suspense fallback={<PageLoader />}><CandidaturePage /></Suspense>} />

          {/* Feedback (v2.10) */}
          <Route path="feedback" element={<Suspense fallback={<PageLoader />}><FeedbackPage /></Suspense>} />

          {/* Changelogs (v2.14) */}
          <Route path="changelogs" element={<Suspense fallback={<PageLoader />}><Changelogs /></Suspense>} />

          {/* GitHub OAuth callback (lazy) */}
          <Route path="github/callback" element={<Suspense fallback={<PageLoader />}><GithubCallback /></Suspense>} />

          {/* Username → profile resolver (lazy) */}
          <Route path="u/:username" element={<Suspense fallback={<PageLoader />}><UserRedirect /></Suspense>} />

          {/* Catch-all 404 within network scope */}
          <Route path="*" element={<Suspense fallback={<PageLoader />}><NotFound /></Suspense>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
