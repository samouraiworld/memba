/**
 * routeMeta — W6.3 PR1: the per-route SEO meta map.
 *
 * A pure lookup from a network-stripped pathname to the meta payload the
 * central RouteMetaSync applies on navigation: meta description, og:title /
 * og:description, og:url + canonical.
 *
 * DELIBERATELY does not manage document.title — pages own their titles today
 * (the M6 per-page pattern), and React runs parent (Layout) effects after
 * child (page) effects, so a central title-setter would clobber dynamic page
 * titles (proposal names, validator monikers). og:title is set from this map
 * independently of the visible tab title.
 *
 * First matching entry wins; keep specific patterns above general ones.
 */

export interface RouteMeta {
    /** og:title (NOT document.title — see module doc). */
    title: string
    /** meta description + og:description. */
    description: string
}

const SITE = "Memba — Gno Multisig & DAO Governance"
const DEFAULT_DESCRIPTION =
    "Memba is a standalone Gno-native multisig wallet and DAO governance application."

interface RouteMetaEntry extends RouteMeta {
    pattern: RegExp
}

/** Ordered map over NETWORK-STRIPPED paths ("/dao", not "/test13/dao"). */
export const ROUTE_META: RouteMetaEntry[] = [
    { pattern: /^\/$/, title: SITE, description: DEFAULT_DESCRIPTION },
    { pattern: /^\/dao(\/|$)/, title: "DAOs — Memba", description: "Discover, join, and govern Gno DAOs: proposals, voting, membership, and treasuries on gno.land." },
    { pattern: /^\/tokens(\/|$)/, title: "Tokens — Memba", description: "Explore GRC20 tokens on gno.land — balances, transfers, OTC swaps, and token creation." },
    { pattern: /^\/directory(\/|$)/, title: "Directory — Memba", description: "The gno.land organization hub: packages, DAOs, realms, tokens, and users — with on-chain source for every realm." },
    { pattern: /^\/validators\/hacker$/, title: "Validators (Hacker view) — Memba", description: "Live gno.land consensus telemetry: block heatmap, peer topology, and validator signatures in real time." },
    { pattern: /^\/validators(\/|$)/, title: "Validators — Memba", description: "The gno.land validator set: voting power, uptime, participation, and community reviews." },
    { pattern: /^\/marketplace(\/|$)/, title: "Marketplace — Memba", description: "The Gno marketplace: NFTs, tokens, and services with on-chain fees flowing to the Memba DAO." },
    { pattern: /^\/nft(\/|$)/, title: "NFT — Memba", description: "Mint, collect, and trade NFTs on gno.land — launchpad, collections, and marketplace." },
    { pattern: /^\/quests(\/|$)/, title: "GnoBuilders Quests — Memba", description: "Earn on-chain XP and badges by building on gno.land — quests, ranks, and the GnoBuilders leaderboard." },
    { pattern: /^\/feed(\/|$)/, title: "Feed — Memba", description: "A global, on-chain social feed for the Memba community — post, reply, and discuss on gno.land." },
    { pattern: /^\/leaderboard(\/|$)/, title: "Leaderboard — Memba", description: "GnoBuilders leaderboard — top contributors on gno.land by on-chain XP." },
    { pattern: /^\/gnolove(\/|$)/, title: "Gnolove — Memba", description: "Gno ecosystem analytics: contributions, teams, and community activity across gno.land." },
    { pattern: /^\/changelogs(\/|$)/, title: "Changelogs — Memba", description: "Every Memba release and gno.land ecosystem update, generated straight from the changelog." },
    { pattern: /^\/extensions(\/|$)/, title: "Extensions — Memba", description: "Extend Memba with ecosystem integrations and upcoming features for gno.land DAOs and wallets." },
    { pattern: /^\/blog(\/|$)/, title: "Blog — Memba", description: "Memba and gno.land ecosystem updates from the Samourai Coop — releases, governance, and builder notes." },
    { pattern: /^\/multisig(\/|$)/, title: "Multisig — Memba", description: "Gno-native multisig wallets: propose, sign, and broadcast transactions with your co-signers." },
    { pattern: /^\/profile(\/|$)/, title: "Profile — Memba", description: "On-chain profile: activity, reviews, XP, and holdings on gno.land." },
]

const DEFAULT_META: RouteMeta = { title: SITE, description: DEFAULT_DESCRIPTION }

/** Strip a leading "/:network" segment (network keys are word-chars). */
export function stripNetworkPrefix(pathname: string, networkKey: string): string {
    const prefix = `/${networkKey}`
    if (pathname === prefix) return "/"
    return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : pathname
}

/** Resolve the meta payload for a pathname (never null — falls back to site default). */
export function matchRouteMeta(pathname: string, networkKey: string): RouteMeta {
    const path = stripNetworkPrefix(pathname, networkKey)
    for (const e of ROUTE_META) {
        if (e.pattern.test(path)) return { title: e.title, description: e.description }
    }
    return DEFAULT_META
}
