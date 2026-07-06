import { lazy, Suspense, useEffect } from "react"
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom"
import { useAdena } from "./hooks/useAdena"
import { useNetworkKey } from "./hooks/useNetworkNav"
import { Layout } from "./components/layout/Layout"
import { ScrollToTop } from "./components/layout/ScrollToTop"
import { NetworkSync } from "./components/layout/NetworkSync"
import { LegacyRedirect } from "./components/layout/LegacyRedirect"
import { ConnectingLoader } from "./components/ui/ConnectingLoader"
import { NftGate } from "./components/ui/NftGate"
import { FeedGate } from "./components/ui/FeedGate"
import { ValoperRouteRedirect } from "./components/validators/ValoperRouteRedirect"
import { NETWORKS, DEFAULT_NETWORK } from "./lib/config"

// ── Core multisig pages (small, always needed) ──
import { CreateMultisig } from "./pages/CreateMultisig"
import { ImportMultisig } from "./pages/ImportMultisig"
import { MultisigView } from "./pages/MultisigView"
import { ProposeTransaction } from "./pages/ProposeTransaction"
import { TransactionView } from "./pages/TransactionView"

// ── Critical Lazy Pages (Prefetched for Performance) ──
const ProfilePage = lazy(() => import("./pages/ProfilePage").then(m => ({ default: m.ProfilePage })))
const UnifiedMarketplace = lazy(() => import("./pages/UnifiedMarketplace"))
const DAOList = lazy(() => import("./pages/DAOList").then(m => ({ default: m.DAOList })))
const TokenDashboard = lazy(() => import("./pages/TokenDashboard").then(m => ({ default: m.TokenDashboard })))

// ── Home — the Control Room landing (lazy so it stays out of the main entry chunk) ──
const Home = lazy(() => import("./pages/Home").then(m => ({ default: m.Home })))

// ── Token pages (lazy — loaded on /tokens or /create-token) ──
const CreateToken = lazy(() => import("./pages/CreateToken").then(m => ({ default: m.CreateToken })))
const TokenView = lazy(() => import("./pages/TokenView").then(m => ({ default: m.TokenView })))

// ── DAO pages (lazy — loaded on /dao/*) ──
const CreateDAO = lazy(() => import("./pages/CreateDAO").then(m => ({ default: m.CreateDAO })))
import { DAORouter } from "./components/dao/DAORouter"

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
const ValidatorProfile = lazy(() => import("./pages/ValidatorProfile"))

// ── Multisig Hub (lazy — v2.7) ──
const MultisigHub = lazy(() => import("./pages/MultisigHub"))

// ── Extensions Hub (lazy — v2.6) ──
const Extensions = lazy(() => import("./pages/Extensions").then(m => ({ default: m.Extensions })))

// ── Feedback page (lazy — v2.10) ──
const FeedbackPage = lazy(() => import("./pages/FeedbackPage"))
// ── Social feed (W7.2, behind VITE_ENABLE_FEED via FeedGate) ──
const FeedPage = lazy(() => import("./pages/FeedPage"))
const FeedThread = lazy(() => import("./pages/FeedThread"))
const FeedProfile = lazy(() => import("./pages/FeedProfile"))
const QuestHub = lazy(() => import("./pages/QuestHub"))
const QuestDetail = lazy(() => import("./pages/QuestDetail"))
const QuestAdmin = lazy(() => import("./pages/QuestAdmin"))
const Leaderboard = lazy(() => import("./pages/Leaderboard"))

// ── Alerts page (lazy — v2.18.0) ──
const AlertsPage = lazy(() => import("./pages/AlertsPage"))

// ── Organizations page (lazy — v2.22.0) ──
const OrganizationsPage = lazy(() => import("./pages/OrganizationsPage"))

// ── Gnolove section (lazy — v2.19.0) ──
const GnoloveLayout = lazy(() => import("./layouts/GnoloveLayout"))
const GnoloveHome = lazy(() => import("./pages/gnolove/GnoloveHome"))
const GnoloveReport = lazy(() => import("./pages/gnolove/GnoloveReport"))
const GnoloveNotablePRs = lazy(() => import("./pages/gnolove/GnoloveNotablePRs"))
const GnoloveAnalytics = lazy(() => import("./pages/gnolove/GnoloveAnalytics"))
const GnoloveContributorProfile = lazy(() => import("./pages/gnolove/GnoloveContributorProfile"))
const GnoloveTeams = lazy(() => import("./pages/gnolove/GnoloveTeams"))
const GnoloveTeamProfile = lazy(() => import("./pages/gnolove/GnoloveTeamProfile"))
const GnoloveAIReports = lazy(() => import("./pages/gnolove/GnoloveAIReports"))
const GnoloveMilestone = lazy(() => import("./pages/gnolove/GnoloveMilestone"))

// ── NFT section (lazy — v3.0 gallery → v3.1 launchpad → Phase 2 marketplace) ──
const CollectionPublic = lazy(() => import("./pages/CollectionPublic").then(m => ({ default: m.CollectionPublic })))
const TokenDetail = lazy(() => import("./pages/TokenDetail").then(m => ({ default: m.TokenDetail })))
const LegacyCollectionView = lazy(() => import("./pages/LegacyCollectionView").then(m => ({ default: m.LegacyCollectionView })))
const CreateCollectionLaunchpad = lazy(() => import("./pages/CreateCollectionLaunchpad"))
const CreatorProfile = lazy(() => import("./pages/CreatorProfile"))
const StudioHome = lazy(() => import("./pages/studio/StudioHome").then(m => ({ default: m.StudioHome })))
const StudioManage = lazy(() => import("./pages/studio/StudioManage").then(m => ({ default: m.StudioManage })))

// ── Candidature page (lazy — v2.28) ──
const CandidaturePage = lazy(() => import("./pages/CandidaturePage"))

// ── Changelogs page (lazy — v2.14) ──
const Changelogs = lazy(() => import("./pages/Changelogs"))
const BlogList = lazy(() => import("./pages/Blog").then(m => ({ default: m.BlogList })))
const BlogArticlePage = lazy(() => import("./pages/Blog").then(m => ({ default: m.BlogArticlePage })))

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

/** Renders the mode-aware Control Room Home for both visitors and members. */
function HomeRedirect() {
  const adena = useAdena()
  return (
    <Suspense fallback={<PageLoader />}>
      <Home mode={adena.connected ? "member" : "visitor"} />
    </Suspense>
  )
}

/** Legacy /:network/dashboard → the network home (canonical trailing-slash URL). */
function DashboardRedirect() {
  const networkKey = useNetworkKey()
  return <Navigate to={`/${networkKey}/`} replace />
}

/** Redirects bare / to /:defaultNetwork/ */
function RootRedirect() {
  const stored = localStorage.getItem("memba_network")
  const network = (stored && NETWORKS[stored]) ? stored : DEFAULT_NETWORK
  return <Navigate to={`/${network}/`} replace />
}

/**
 * Retires the standalone code-gen wizard (nft/create/advanced).
 * Redirects to the network-scoped /nft/create, preserving the :network prefix.
 * e.g. /test13/nft/create/advanced → /test13/nft/create
 */
function AdvancedWizardRedirect() {
  const networkKey = useNetworkKey()
  return <Navigate to={`/${networkKey}/nft/create`} replace />
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
      <Routes>
        {/* Root → redirect to /:defaultNetwork/ */}
        <Route path="/" element={<RootRedirect />} />

        {/* ── Network-scoped routes ─────────────────────────── */}
        <Route path="/:network" element={<NetworkGate />}>
          {/* Network index → the Control Room home (mode-aware: visitor / member) */}
          <Route index element={<HomeRedirect />} />

          {/* Dashboard — old /dashboard links land on the new home */}
          <Route path="dashboard" element={<DashboardRedirect />} />

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
          {/* CRITICAL: /validators/hacker + /validators/valoper/* must come BEFORE /validators/:address */}
          <Route path="validators/hacker" element={<Suspense fallback={<PageLoader />}><ValidatorsHacker /></Suspense>} />
          {/* Legacy operator route → redirect to the unified canonical profile. */}
          <Route path="validators/valoper/:operatorAddress" element={<ValoperRouteRedirect />} />
          <Route path="validators/:address" element={<Suspense fallback={<PageLoader />}><ValidatorProfile /></Suspense>} />

          {/* NFT section (Phase 2) — ORDER MATTERS: specific routes before /nft/:realmPath catch-all */}
          {/* Hub: Redirect old /nft to the unified marketplace */}
          <Route path="nft" element={<Navigate to="../marketplace/nfts" replace />} />
          {/* Create: register into the shared memba_collections registry. */}
          <Route path="nft/create" element={<Suspense fallback={<PageLoader />}><CreateCollectionLaunchpad /></Suspense>} />
          {/* Advanced wizard retired — redirect to /nft/create, preserving :network prefix. */}
          <Route path="nft/create/advanced" element={<AdvancedWizardRedirect />} />
          {/* Collection public page: detail / mint / activity. NftGate preserves the
              #472 route-level VITE_ENABLE_NFT enforcement on top of page self-gating. */}
          <Route path="nft/collection/:creator/:slug" element={<NftGate><Suspense fallback={<PageLoader />}><CollectionPublic /></Suspense></NftGate>} />
          <Route path="nft/token/:creator/:slug/:tokenId" element={<NftGate><Suspense fallback={<PageLoader />}><TokenDetail /></Suspense></NftGate>} />
          {/* Creator profiles — must be before nft/:realmPath catch-all */}
          <Route path="nft/creator/:address" element={<NftGate><Suspense fallback={<PageLoader />}><CreatorProfile /></Suspense></NftGate>} />
          <Route path="nft/creator" element={<NftGate><Suspense fallback={<PageLoader />}><CreatorProfile /></Suspense></NftGate>} />
          {/* Creator Studio — must be before nft/:realmPath catch-all */}
          <Route path="nft/studio" element={<NftGate><Suspense fallback={<PageLoader />}><StudioHome /></Suspense></NftGate>} />
          <Route path="nft/studio/:creator/:slug" element={<NftGate><Suspense fallback={<PageLoader />}><StudioManage /></Suspense></NftGate>} />
          {/* LAST: legacy catch-all for standalone realm paths (e.g. /nft/gno.land/r/...). */}
          <Route path="nft/:realmPath" element={<NftGate><Suspense fallback={<PageLoader />}><LegacyCollectionView /></Suspense></NftGate>} />

          {/* Freelance Services (v3.0) - redirected to unified marketplace */}
          <Route path="services" element={<Navigate to="../marketplace/services" replace />} />

          {/* Extensions Hub (v2.6) */}
          <Route path="extensions" element={<Suspense fallback={<PageLoader />}><Extensions /></Suspense>} />

          {/* Unified Marketplace (v3.0) */}
          <Route path="marketplace/*" element={<Suspense fallback={<PageLoader />}><UnifiedMarketplace /></Suspense>} />

          {/* Alerts — Professional alerting (v2.18.0) */}
          <Route path="alerts" element={<Suspense fallback={<PageLoader />}><AlertsPage /></Suspense>} />

          {/* Organizations — Team management (v2.22.0) */}
          <Route path="organizations" element={<Suspense fallback={<PageLoader />}><OrganizationsPage /></Suspense>} />

          {/* Gnolove — Contributor scoreboard & analytics (v2.19.0) */}
          <Route path="gnolove" element={<Suspense fallback={<PageLoader />}><GnoloveLayout /></Suspense>}>
            <Route index element={<GnoloveHome />} />
            <Route path="report" element={<GnoloveReport />} />
            <Route path="notable-prs" element={<GnoloveNotablePRs />} />
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
          <Route path="quest-admin" element={<Suspense fallback={<PageLoader />}><QuestAdmin /></Suspense>} />
          <Route path="leaderboard" element={<Suspense fallback={<PageLoader />}><Leaderboard /></Suspense>} />

          {/* Candidature — Memba DAO membership application (v2.28) */}
          <Route path="candidature" element={<Suspense fallback={<PageLoader />}><CandidaturePage /></Suspense>} />

          {/* Feedback (v2.10) */}
          <Route path="feedback" element={<Suspense fallback={<PageLoader />}><FeedbackPage /></Suspense>} />
          {/* Social feed — FeedGate makes the flag-off state authoritative at the router. */}
          <Route path="feed" element={<FeedGate><Suspense fallback={<PageLoader />}><FeedPage /></Suspense></FeedGate>} />
          <Route path="feed/post/:id" element={<FeedGate><Suspense fallback={<PageLoader />}><FeedThread /></Suspense></FeedGate>} />
          <Route path="feed/user/:address" element={<FeedGate><Suspense fallback={<PageLoader />}><FeedProfile /></Suspense></FeedGate>} />

          {/* Changelogs (v2.14) */}
          <Route path="changelogs" element={<Suspense fallback={<PageLoader />}><Changelogs /></Suspense>} />
          <Route path="blog" element={<Suspense fallback={<PageLoader />}><BlogList /></Suspense>} />
          <Route path="blog/:slug" element={<Suspense fallback={<PageLoader />}><BlogArticlePage /></Suspense>} />

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
