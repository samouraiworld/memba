import { NETWORKS, MEMBA_DAO, isRealmValid, isRealmValidOn, isFeedEnabled, isAppStoreEnabled, isNftEnabled } from "../../../lib/config"
import { OS_APPS, type OsAppId } from "../../apps"

export type Layer = "onchain" | "offchain" | "hybrid" | "planned"
export interface Brick {
    id: string
    name: string
    summary: string
    layer: Layer
    detail: string
    /** A published path; never fabricate a source URL for a future realm. */
    realm?: string
    account?: string
    code?: string
    available?: boolean
}

const REPO = "https://github.com/samouraiworld/memba/tree/main/"
const SAMCREW = "gno.land/r/samcrew/"
const appInfo: Record<OsAppId, { layer: Layer; detail: string; realm?: string; available?: boolean }> = {
    notes: { layer: "onchain", detail: "Read public notes on Gno. Comment actions are reviewed before your connected wallet signs; availability depends on the network release." },
    radio: { layer: "hybrid", detail: "Live schedules are read from Gno Radio on Onyx. Music and artwork stream from external providers; listening needs no wallet." },
    daos: { layer: "onchain", detail: "Members, voting rules, proposals and execution live in Gno realms. The browser prepares actions; your wallet signs. Control of each application is handed over separately." },
    wallet: { layer: "hybrid", detail: "Balances and settled transfers are onchain. The OS prepares transactions; your connected wallet holds keys and signs locally." },
    multisig: { layer: "hybrid", detail: "Shared accounts require several signatures. Public keys and settled transactions are onchain; proposal coordination and signature collection use Memba’s backend. Inspect an account to see its public record." },
    feed: { layer: "hybrid", detail: "Posts, replies and moderation records live on Gno. A backend indexes them for reading; attached media is hosted outside the chain.", realm: MEMBA_DAO.feedPath, available: isFeedEnabled() },
    live: { layer: "hybrid", detail: "A readable view of chain events assembled through RPC and indexed data. The index is a convenience layer; the chain remains the source of settled state." },
    store: { layer: "hybrid", detail: "Listings and curator decisions are recorded in Gno realms. App assets and third-party apps run outside those realms. Submission and review actions depend on release flags.", realm: MEMBA_DAO.appStorePath, available: isAppStoreEnabled() },
    arcade: { layer: "hybrid", detail: "Games run in your browser. Score verification uses a server; leaderboard publication depends on the active deployment and release flags.", realm: SAMCREW + "memba_arcade_leaderboard_v1" },
    validators: { layer: "hybrid", detail: "Validator membership comes from the chain; uptime and alerts use external monitoring services. Enabled reviews are onchain.", realm: MEMBA_DAO.reviewsPath },
    settings: { layer: "offchain", detail: "Appearance, desktop preferences and local safety settings stay in the browser. Network selection changes which chain the OS reads." },
    tokens: { layer: "onchain", detail: "Token creation, fair sales, vesting and airdrops run in the Launchpad realms on Gno. The sales realm holds what sales owe and pays each exit only to its recorded receiver; a paused lane takes no new launch or order, and exits keep working. Trading tokens is a separate, later step.", realm: SAMCREW + "launchpad/sales/v1", available: isRealmValid(SAMCREW + "launchpad/sales/v1") },
    nft: { layer: "onchain", detail: "Collections, minting, curation and trading run in the Launchpad's NFT realms on Gno. Media stays outside the chain, with references in the ledger. Each network opens them separately; on mainnet they are published but not open yet.", realm: SAMCREW + "launchpad/nft/v1", available: isNftEnabled() && isRealmValid(SAMCREW + "launchpad/nft/v1") },
    market: { layer: "hybrid", detail: "Services use an onchain escrow to hold funds and settle work under its rules. NFT and token trading are separate upcoming lanes. Service availability is release-gated.", realm: MEMBA_DAO.escrowPath },
    quests: { layer: "hybrid", detail: "Activity checks and XP use the backend and browser. Signed quest attestations can be claimed on Gno. XP does not automatically grant DAO voting power or rewards.", realm: SAMCREW + "memba_quest_attestation_v1" },
    explorer: { layer: "hybrid", detail: "Reads chain records and realm code through RPC and explorers. Directory indexes help discovery; published source is the reference." },
    profile: { layer: "hybrid", detail: "Published profiles and usernames live in Gno realms. Drafts stay local, and images are externally hosted. Publishing depends on the active network and release gates.", realm: "gno.land/r/demo/profile" },
    news: { layer: "offchain", detail: "Blog posts and release notes are published with Memba’s source and frontend releases." },
    devreport: { layer: "offchain", detail: "Gno development reports combine GitHub activity and the Gnolove service; they are not stored in Memba realms." },
    terminal: { layer: "hybrid", detail: "Explore the chain through RPC and edit Gno drafts locally. A draft is not published merely by opening or editing it." },
    learn: { layer: "offchain", detail: "PeerDev lessons and learning content are served outside the chain." },
    meet: { layer: "offchain", detail: "Video meetings use Jitsi outside the chain. Audio and video are not written into public realms." },
}

export const FEATURES: readonly Brick[] = OS_APPS.map(app => ({
    id: app.id, name: app.id === "multisig" ? "Shared wallets" : app.name,
    summary: app.id === "tokens" ? "Create tokens and fund projects" : app.id === "nft" ? "Create, collect and curate NFTs" : app.summary,
    ...appInfo[app.id], code: REPO + (app.id === "devreport" ? "frontend/src/pages/gnolove"
        : app.id === "daos" || app.id === "wallet" || app.id === "multisig" ? `frontend/src/os/${app.id}` : `frontend/src/os/apps/${app.id}`),
}))

export const FAMILIES = [
    { name: "Organise", summary: "Decide together, manage shared funds", apps: ["daos", "wallet", "multisig"] },
    { name: "Connect", summary: "Share, meet and stay informed", apps: ["feed", "profile", "meet", "news"] },
    { name: "Create & exchange", summary: "Discover apps, fund projects, hire", apps: ["store", "tokens", "nft", "market"] },
    { name: "Explore & grow", summary: "Play, learn and understand Gno", apps: ["arcade", "quests", "live", "validators", "explorer", "devreport", "terminal", "learn", "settings"] },
] as const

export const DAO: Brick = {
    id: "memba-dao", name: "Memba DAO", summary: "Shared governance, progressive stewardship", layer: "onchain",
    realm: MEMBA_DAO.realmPath, code: REPO + "frontend/src/lib/dao",
    detail: "Founded by the Samouraï Coop core developers. The DAO records members, voting weights, proposals and decisions on Gno. Application control transfers through explicit handovers; publication alone does not give it authority over every feature. Broader membership, responsibility and contributor rewards are the vision, not automatic entitlements.",
}
export const STEWARDSHIP: Brick = {
    id: "stewardship", name: "Platform Stewardship", summary: "The founding team’s shared account", layer: "onchain",
    account: "g136j0m08pkm2lwwde9dmlx8uee26llent9s5cpf", code: REPO + "frontend/src/os/multisig",
    detail: "The founding shared account publishes and administers applications until their individual handovers are accepted. Each contract defines its current administrator and fee receiver. This is an account, so its public record differs from a realm’s source code.",
}
export const RESERVE: Brick = {
    id: "reserve", name: "Community Reserve", summary: "Home of community revenue", layer: "onchain",
    account: "g1jw76lxvzjafw2kyjhdnzwggcftyhnlfjaer2u0", code: REPO + "frontend/src/os/multisig",
    detail: "The shared wallet the Token Launchpad names as its treasury: swept Launchpad fees are paid here. How the reserve is spent still needs a community policy and its signers' approval. Inspect the live account record; this diagram does not certify its signer configuration. Operations and Contributor Rewards may initially be budgets within this reserve rather than separate accounts.",
}
export const OPERATIONS: Brick = { id: "operations", name: "Operations", summary: "Maintain and improve the OS", layer: "planned", detail: "Proposed allocation for development, infrastructure and maintenance. No dedicated wallet is assigned here; allocations require an explicit community policy." }
export const REWARDS: Brick = { id: "rewards", name: "Contributor Rewards", summary: "Reward approved responsibilities", layer: "planned", detail: "Proposed allocation for reviewers, moderators and other contributors. Roles, eligibility and payments need governance decisions. Usage or XP alone promises neither a role nor payment. No dedicated wallet is assigned here." }

/** Match the window's selected chain, never fall back to mainnet for a testnet. */
export function publicTarget(brick: Brick, chainId: string): { href: string; kind: "Source" | "Account" } | undefined {
    const entry = Object.entries(NETWORKS).find(([, network]) => network.chainId === chainId)
    if (!entry) return undefined
    const [key, network] = entry
    if (brick.account && chainId === NETWORKS.mainnet.chainId) return {
        href: `${network.rpcUrl.replace(/\/$/, "")}/abci_query?path=${encodeURIComponent(`"auth/accounts/${brick.account}"`)}`, kind: "Account",
    }
    // The founding DAO and its packages are individually verified deployments,
    // distinct from the factory's callable-application allowlist.
    const verifiedCore = chainId === NETWORKS.mainnet.chainId && (brick.realm === "gno.land/r/samcrew/memba_dao"
        || brick.realm === "gno.land/p/samcrew/memba_weighted_host" || brick.realm === "gno.land/p/samcrew/memba_weighted_policy"
        || brick.realm === "gno.land/r/samcrew/memba_dao_channels_v2" || brick.realm === "gno.land/r/samcrew/memba_arcade_leaderboard_v1"
        || brick.realm === "gno.land/r/samcrew/memba_market_config" || brick.realm === "gno.land/r/demo/profile")
    if (brick.realm && (verifiedCore || isRealmValidOn(key, brick.realm))) return {
        href: `${network.explorerUrl.replace(/\/$/, "")}/${brick.realm.replace(/^gno\.land\//, "")}$source`, kind: "Source",
    }
    return undefined
}

export const PACKAGES: readonly Brick[] = [
    { id: "host", name: "Governance engine", summary: "DAO actions and application interfaces", layer: "onchain", realm: "gno.land/p/samcrew/memba_weighted_host", detail: "The reusable package implementing weighted DAO actions, reads and application handovers." },
    { id: "policy", name: "Governance rules", summary: "Proposal and voting policy", layer: "onchain", realm: "gno.land/p/samcrew/memba_weighted_policy", detail: "The reusable policy package supporting weighted governance." },
    { id: "channels", name: "Community channels", summary: "DAO conversations and membership", layer: "onchain", realm: MEMBA_DAO.channelsPath, detail: "Onchain community channels. Admission depends on the current owner and pending handover state, as reported by the membership notice below." },
    { id: "reviews", name: "Public reviews", summary: "App, profile and validator reviews", layer: "onchain", realm: MEMBA_DAO.reviewsPath, detail: "Published reviews and their moderation state live on Gno. Each type of review depends on its release flag." },
    { id: "market-policy", name: "Exchange policy", summary: "Market fees and treasury routing", layer: "onchain", realm: SAMCREW + "memba_market_config", detail: "The deployed market policy defines fees and treasury routing. The Launchpad has its own configuration realm, launchpad/config/v1, with its own fees and treasury." },
    { id: "badges", name: "Builder badges", summary: "Onchain contribution credentials", layer: "onchain", realm: MEMBA_DAO.badgesPath, detail: "Contribution badges issued through the deployed badge realm; independent from backend XP." },
    { id: "feedback", name: "Feedback", summary: "Public requests and issues", layer: "onchain", realm: "gno.land/r/samcrew/memba_feedback_v2", detail: "Feedback records are published on Gno. Use the feedback action below to read or send feedback." },
]
