/**
 * Memba OS app registry — every Memba route belongs to exactly one app, or to
 * the system list. apps.test.ts reads the route table (App.tsx, routes/networkRoutes.tsx) and fails if a route is added
 * without a home here, so the desktop can never silently lose a page.
 *
 * Route strings are relative to /:network, exactly as the route table writes them;
 * nested routes carry their parent (gnolove/report).
 *
 * @module os/apps
 */

/** When an app gets its native window layout. Until then its routes open as pages in a window. */
export type AppTier = "mvp" | "v1.1" | "v1.2" | "v1.3"

export type OsAppId =
    | "daos" | "wallet" | "multisig" | "feed" | "store" | "arcade" | "validators" | "settings"
    | "tokens" | "nft" | "market" | "quests" | "explorer" | "profile" | "news" | "devreport" | "terminal"

export interface OsApp {
    id: OsAppId
    name: string
    /** URL segment: /os/<slug> */
    slug: string
    summary: string
    tier: AppTier
    /** Tile gradient, from → to. */
    tint: readonly [string, string]
    /** Shown in the dock by default. */
    dock: boolean
    routes: readonly string[]
}

export const OS_APPS: readonly OsApp[] = [
    { id: "daos", name: "DAOs", slug: "daos", summary: "Browse, create and govern DAOs", tier: "mvp", tint: ["#5B7CFA", "#3D5BE0"], dock: true,
      routes: ["dao", "dao/create", "dao/*", "weighted-dao/*", "organizations", "candidature"] },
    { id: "wallet", name: "Wallet", slug: "wallet", summary: "Balances, send, receive, history", tier: "mvp", tint: ["#2FC08E", "#12A07A"], dock: true,
      routes: ["tx/:id"] },
    { id: "multisig", name: "Multisig", slug: "multisig", summary: "Shared accounts that need several signatures", tier: "mvp", tint: ["#9C7CF5", "#7654E8"], dock: true,
      routes: ["multisig", "create", "import", "multisig/:address", "multisig/:address/propose"] },
    { id: "feed", name: "Feed", slug: "feed", summary: "Posts, threads and moderation", tier: "mvp", tint: ["#FF9A62", "#F0703F"], dock: true,
      routes: ["feed", "feed/post/:id", "feed/user/:address", "feed/mod", "feed/transparency"] },
    { id: "store", name: "App Store", slug: "store", summary: "On-chain app listings, submissions, extensions", tier: "mvp", tint: ["#46B8F0", "#1E90D8"], dock: true,
      routes: ["apps/*", "apps/submit", "apps/review", "apps/my-submissions", "extensions"] },
    { id: "arcade", name: "Arcade", slug: "arcade", summary: "Three playable games and daily challenges", tier: "mvp", tint: ["#F46BA0", "#D9467E"], dock: true,
      routes: ["game", "game/space-invaders", "game/barricade"] },
    { id: "validators", name: "Validators", slug: "validators", summary: "Validator set, monitoring and alerts", tier: "mvp", tint: ["#4A5368", "#232836"], dock: true,
      routes: ["validators", "validators/hacker", "validators/valoper/:operatorAddress", "validators/:address", "alerts"] },
    { id: "settings", name: "Settings", slug: "settings", summary: "Desktop, notifications, safety, network, account", tier: "mvp", tint: ["#A9B1C2", "#7E879A"], dock: false,
      routes: ["settings"] },
    { id: "tokens", name: "Tokens", slug: "tokens", summary: "Create, hold and trade GRC20 tokens", tier: "v1.1", tint: ["#F2B544", "#E08A1E"], dock: false,
      routes: ["tokens", "tokens/:symbol", "create-token"] },
    { id: "nft", name: "NFT", slug: "nft", summary: "Collections, studio and launchpad", tier: "v1.1", tint: ["#EC6FCF", "#A34FE0"], dock: false,
      routes: ["nft", "nft/create", "nft/create/advanced", "nft/collection/:creator/:slug", "nft/token/:creator/:slug/:tokenId", "nft/creator",
          "nft/creator/:address", "nft/studio", "nft/studio/:creator/:slug", "nft/:realmPath"] },
    { id: "market", name: "Market", slug: "market", summary: "Hire with escrow, trade NFTs and tokens", tier: "v1.1", tint: ["#5AA9FF", "#6B5BFA"], dock: false,
      routes: ["marketplace/*", "services"] },
    { id: "quests", name: "Quests", slug: "quests", summary: "Quests, XP, ranks and the XP leaderboard", tier: "v1.1", tint: ["#7AD36B", "#2FA35A"], dock: false,
      routes: ["quests", "quests/:questId", "quest-admin", "points", "leaderboard"] },
    { id: "explorer", name: "Explorer", slug: "explorer", summary: "Realm directory and on-chain explorer", tier: "v1.1", tint: ["#5AC8C8", "#2E8C9C"], dock: false,
      routes: ["directory", "explorer/*"] },
    { id: "profile", name: "Profile", slug: "profile", summary: "Your profile and other people’s", tier: "v1.1", tint: ["#8E9BB5", "#56627C"], dock: false,
      routes: ["profile", "profile/:address", "u/:username"] },
    { id: "news", name: "News", slug: "news", summary: "Blog and changelog", tier: "v1.1", tint: ["#FF7A7A", "#E0463B"], dock: false,
      routes: ["blog", "blog/:slug", "changelogs"] },
    { id: "devreport", name: "Dev Report", slug: "dev-report", summary: "Gno development activity: contributors, teams, reports", tier: "v1.2", tint: ["#6D8BFF", "#2B4FD8"], dock: false,
      routes: ["gnolove", "gnolove/report", "gnolove/notable-prs", "gnolove/analytics", "gnolove/contributor/:login", "gnolove/teams",
          "gnolove/teams/:teamName", "gnolove/reports", "gnolove/milestone"] },
    { id: "terminal", name: "Terminal", slug: "terminal", summary: "Write, run and deploy Gno code", tier: "v1.3", tint: ["#2B3040", "#0F1117"], dock: false,
      routes: [] },
] as const

/** Routes that aren't an app: the desktop itself, redirects, callbacks and retired previews. */
export const OS_SYSTEM_ROUTES: readonly { route: string; handling: string }[] = [
    { route: "/", handling: "The desktop" },
    { route: "/:network", handling: "The desktop, on that network" },
    { route: "dashboard", handling: "The desktop (dashboard cards become widgets)" },
    { route: "github/callback", handling: "Sign-in callback, no window" },
    { route: "feedback", handling: "The Send feedback window (/os/feedback), from the start menu" },
    { route: "marketplace-v2-preview", handling: "Dropped: preview route, not carried over" },
    { route: "*", handling: "A not-found window that offers search" },
]

const BY_ID = new Map(OS_APPS.map((app) => [app.id, app]))

export function getApp(id: OsAppId): OsApp {
    const app = BY_ID.get(id)
    if (!app) throw new Error(`Unknown Memba OS app: ${id}`)
    return app
}

/** The app that owns a route string (as written in the route table), if any. */
export function appForRoute(route: string): OsApp | undefined {
    return OS_APPS.find((app) => app.routes.includes(route))
}

export const DOCK_APPS: readonly OsApp[] = OS_APPS.filter((app) => app.dock)
