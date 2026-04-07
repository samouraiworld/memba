/**
 * gnobuilders.ts — GnoBuilders: The Gno Developer Game
 *
 * Expanded quest system with 85 quests across 4 categories,
 * 8-tier rank system, and badge/cosmetics infrastructure.
 *
 * This module defines quest metadata and rank thresholds.
 * Quest completion logic remains in quests.ts for backward compat.
 */

// ── Types ────────────────────────────────────────────────────

export type QuestCategory = "developer" | "everyone" | "champion" | "hidden"
export type QuestDifficulty = "beginner" | "intermediate" | "advanced" | "expert"
export type QuestVerification = "on_chain" | "off_chain" | "social" | "self_report"

export interface GnoQuest {
    id: string
    title: string
    description: string
    xp: number
    icon: string
    category: QuestCategory
    difficulty: QuestDifficulty
    verification: QuestVerification
    /** Quest ID that must be completed first, or undefined */
    prerequisite?: string
    /** If true, quest is hidden until discovered or prerequisite is met */
    hidden?: boolean
    /** Season number (1 = launch to mainnet) */
    season: number
}

// ── Rank System ─────────────────────────────────────────────

export interface RankTier {
    tier: number
    name: string
    xpRequired: number
    color: string
    cssClass: string
    perks: string[]
}

export const RANK_TIERS: RankTier[] = [
    { tier: 0, name: "Newcomer", xpRequired: 0, color: "#6b7280", cssClass: "rank-newcomer", perks: ["Base access"] },
    { tier: 1, name: "Bronze Explorer", xpRequired: 50, color: "#cd7f32", cssClass: "rank-bronze", perks: ["Bronze profile border"] },
    { tier: 2, name: "Silver Builder", xpRequired: 150, color: "#c0c0c0", cssClass: "rank-silver", perks: ["Custom title"] },
    { tier: 3, name: "Gold Architect", xpRequired: 350, color: "#ffd700", cssClass: "rank-gold", perks: ["Candidature unlock", "Profile glow"] },
    { tier: 4, name: "Platinum Master", xpRequired: 600, color: "#e5e4e2", cssClass: "rank-platinum", perks: ["Leaderboard highlight"] },
    { tier: 5, name: "Diamond Sage", xpRequired: 1000, color: "#b9f2ff", cssClass: "rank-diamond", perks: ["Custom profile frame", "Mentor badge"] },
    { tier: 6, name: "Obsidian Legend", xpRequired: 1500, color: "#1a1a2e", cssClass: "rank-obsidian", perks: ["All cosmetics", "DAO founder discount"] },
    { tier: 7, name: "Gno Guardian", xpRequired: 2000, color: "#8b5cf6", cssClass: "rank-guardian", perks: ["Special MembaDAO role", "Ecosystem badge"] },
]

/** Calculate rank from XP */
export function calculateRank(xp: number): RankTier {
    let rank = RANK_TIERS[0]
    for (const tier of RANK_TIERS) {
        if (xp >= tier.xpRequired) rank = tier
        else break
    }
    return rank
}

/** Get XP needed for next rank, or 0 if max rank */
export function xpToNextRank(xp: number): number {
    const current = calculateRank(xp)
    const next = RANK_TIERS[current.tier + 1]
    return next ? next.xpRequired - xp : 0
}

/** Candidature threshold — Gold rank (350 XP) */
export const CANDIDATURE_XP_THRESHOLD_V2 = 350

// ── Quest Definitions ───────────────────────────────────────

// Category 1: Developers (~30 quests)

const DEVELOPER_QUESTS: GnoQuest[] = [
    // Package Deployment Series (10)
    { id: "deploy-hello-pkg", title: "Hello Gno", description: "Deploy a 'Hello World' package on Gno", xp: 20, icon: "📦", category: "developer", difficulty: "beginner", verification: "on_chain", season: 1 },
    { id: "deploy-counter-pkg", title: "State Machine", description: "Deploy a package with mutable state (counter)", xp: 25, icon: "🔢", category: "developer", difficulty: "beginner", verification: "on_chain", prerequisite: "deploy-hello-pkg", season: 1 },
    { id: "deploy-avl-pkg", title: "Tree Builder", description: "Deploy a package using AVL trees for storage", xp: 30, icon: "🌳", category: "developer", difficulty: "intermediate", verification: "on_chain", prerequisite: "deploy-counter-pkg", season: 1 },
    { id: "deploy-interface-pkg", title: "Abstraction Master", description: "Deploy a package that exports an interface", xp: 30, icon: "🧩", category: "developer", difficulty: "intermediate", verification: "on_chain", prerequisite: "deploy-avl-pkg", season: 1 },
    { id: "deploy-test-pkg", title: "Test-Driven Dev", description: "Deploy a package with passing tests (gno test)", xp: 35, icon: "🧪", category: "developer", difficulty: "intermediate", verification: "self_report", prerequisite: "deploy-hello-pkg", season: 1 },
    { id: "deploy-import-pkg", title: "Dependency Chain", description: "Deploy a package that imports another user's package", xp: 35, icon: "🔗", category: "developer", difficulty: "intermediate", verification: "on_chain", prerequisite: "deploy-hello-pkg", season: 1 },
    { id: "deploy-event-pkg", title: "Event Emitter", description: "Deploy a package that uses std.Emit() events", xp: 40, icon: "📡", category: "developer", difficulty: "advanced", verification: "on_chain", prerequisite: "deploy-counter-pkg", season: 1 },
    { id: "deploy-ownable-pkg", title: "Access Control", description: "Deploy a package with owner-only functions", xp: 40, icon: "🔐", category: "developer", difficulty: "advanced", verification: "on_chain", prerequisite: "deploy-interface-pkg", season: 1 },
    { id: "deploy-upgradable-pkg", title: "Evolving Code", description: "Deploy a package using gnodaokit's upgradable pattern", xp: 50, icon: "🔄", category: "developer", difficulty: "expert", verification: "on_chain", prerequisite: "deploy-ownable-pkg", season: 1 },
    { id: "deploy-governance-pkg", title: "Governance Architect", description: "Deploy a full DAO with basedao + custom conditions", xp: 60, icon: "🏛️", category: "developer", difficulty: "expert", verification: "on_chain", prerequisite: "deploy-upgradable-pkg", season: 1 },

    // Realm Deployment Series (10)
    { id: "deploy-hello-realm", title: "Realm Rookie", description: "Deploy your first realm with Render()", xp: 20, icon: "🌐", category: "developer", difficulty: "beginner", verification: "on_chain", season: 1 },
    { id: "deploy-grc20-realm", title: "Token Creator", description: "Deploy a GRC20 token realm", xp: 30, icon: "🪙", category: "developer", difficulty: "intermediate", verification: "on_chain", prerequisite: "deploy-hello-realm", season: 1 },
    { id: "deploy-grc721-realm", title: "NFT Artist", description: "Deploy a GRC721 NFT collection realm", xp: 35, icon: "🎨", category: "developer", difficulty: "intermediate", verification: "on_chain", prerequisite: "deploy-hello-realm", season: 1 },
    { id: "deploy-board-realm", title: "Forum Builder", description: "Deploy a realm with board/post functionality", xp: 30, icon: "📝", category: "developer", difficulty: "intermediate", verification: "on_chain", prerequisite: "deploy-hello-realm", season: 1 },
    { id: "deploy-dao-realm", title: "DAO Deployer", description: "Deploy a DAO realm using gnodaokit", xp: 40, icon: "🏛️", category: "developer", difficulty: "advanced", verification: "on_chain", prerequisite: "deploy-grc20-realm", season: 1 },
    { id: "deploy-crossing-realm", title: "Cross-Realm Caller", description: "Deploy a realm that calls another realm", xp: 45, icon: "🔀", category: "developer", difficulty: "advanced", verification: "on_chain", prerequisite: "deploy-dao-realm", season: 1 },
    { id: "deploy-escrow-realm", title: "Trust Machine", description: "Deploy an escrow realm with milestone payments", xp: 50, icon: "🤝", category: "developer", difficulty: "expert", verification: "on_chain", prerequisite: "deploy-crossing-realm", season: 1 },
    { id: "deploy-marketplace-realm", title: "Market Maker", description: "Deploy a marketplace realm with listings", xp: 50, icon: "🏪", category: "developer", difficulty: "expert", verification: "on_chain", prerequisite: "deploy-crossing-realm", season: 1 },
    { id: "deploy-multisig-realm", title: "Multi-Signer", description: "Deploy a realm with multi-signature execution", xp: 55, icon: "✍️", category: "developer", difficulty: "expert", verification: "on_chain", prerequisite: "deploy-dao-realm", season: 1 },
    { id: "deploy-full-dapp", title: "Full Stack Gno", description: "Deploy a complete dApp (realm + frontend integration)", xp: 75, icon: "🚀", category: "developer", difficulty: "expert", verification: "self_report", prerequisite: "deploy-dao-realm", season: 1 },

    // Advanced Developer Quests (10)
    { id: "write-10-tests", title: "Test Warrior", description: "Write 10+ passing tests for your realm", xp: 30, icon: "🛡️", category: "developer", difficulty: "intermediate", verification: "self_report", prerequisite: "deploy-hello-realm", season: 1 },
    { id: "fix-upstream-bug", title: "Upstream Contributor", description: "Get a PR merged to gnolang/gno", xp: 100, icon: "🌟", category: "developer", difficulty: "expert", verification: "self_report", season: 1 },
    { id: "audit-realm", title: "Security Auditor", description: "Use Security Guard to audit a realm and fix findings", xp: 40, icon: "🔍", category: "developer", difficulty: "advanced", verification: "self_report", prerequisite: "deploy-hello-realm", season: 1 },
    { id: "deploy-3-chains", title: "Multi-Chain Dev", description: "Deploy the same package on 3 different networks", xp: 45, icon: "🌍", category: "developer", difficulty: "advanced", verification: "on_chain", prerequisite: "deploy-hello-pkg", season: 1 },
    { id: "build-mcp-tool", title: "Agent Builder", description: "Create a custom MCP tool that queries Gno", xp: 50, icon: "🤖", category: "developer", difficulty: "expert", verification: "self_report", season: 1 },
    { id: "gas-optimization", title: "Gas Golfer", description: "Reduce gas usage of a realm operation by 20%+", xp: 40, icon: "⛽", category: "developer", difficulty: "advanced", verification: "self_report", prerequisite: "deploy-hello-realm", season: 1 },
    { id: "render-masterclass", title: "Render Wizard", description: "Deploy a realm with rich Render() output (tables, links, formatting)", xp: 30, icon: "🎭", category: "developer", difficulty: "intermediate", verification: "on_chain", prerequisite: "deploy-hello-realm", season: 1 },
    { id: "gnodaokit-extension", title: "Kit Extender", description: "Create a gnodaokit extension module", xp: 60, icon: "🧰", category: "developer", difficulty: "expert", verification: "self_report", prerequisite: "deploy-dao-realm", season: 1 },
    { id: "deploy-ibc-realm", title: "Bridge Builder", description: "Deploy a realm that handles IBC messages", xp: 75, icon: "🌉", category: "developer", difficulty: "expert", verification: "on_chain", season: 1 },
    { id: "mentor-developer", title: "Gno Mentor", description: "Help 3 other developers complete their first quest", xp: 50, icon: "🎓", category: "developer", difficulty: "advanced", verification: "self_report", season: 1 },
]

// Category 2: Everyone (~30 quests)

const EVERYONE_QUESTS: GnoQuest[] = [
    // Getting Started (10)
    { id: "connect-wallet", title: "Wallet Connected", description: "Connect your Adena wallet to Memba", xp: 10, icon: "🔐", category: "everyone", difficulty: "beginner", verification: "off_chain", season: 1 },
    { id: "setup-profile", title: "Identity", description: "Set up your Memba profile (bio + avatar)", xp: 15, icon: "👤", category: "everyone", difficulty: "beginner", verification: "off_chain", season: 1 },
    { id: "register-username", title: "Named", description: "Register a @username on gno.land", xp: 20, icon: "🏷️", category: "everyone", difficulty: "beginner", verification: "on_chain", season: 1 },
    { id: "first-transaction", title: "First Transaction", description: "Make any transaction on Gno", xp: 15, icon: "💸", category: "everyone", difficulty: "beginner", verification: "on_chain", season: 1 },
    { id: "visit-5-pages", title: "Explorer", description: "Visit 5 different pages in Memba", xp: 10, icon: "🧭", category: "everyone", difficulty: "beginner", verification: "off_chain", season: 1 },
    { id: "use-cmdk", title: "Power User", description: "Use the Cmd+K command palette", xp: 10, icon: "⌨️", category: "everyone", difficulty: "beginner", verification: "off_chain", season: 1 },
    { id: "switch-network", title: "Network Hopper", description: "Switch between two networks", xp: 15, icon: "🌐", category: "everyone", difficulty: "beginner", verification: "off_chain", season: 1 },
    { id: "view-validator", title: "Validator Watcher", description: "View a validator's detail page", xp: 10, icon: "🔗", category: "everyone", difficulty: "beginner", verification: "off_chain", season: 1 },
    { id: "faucet-claim", title: "Free Tokens", description: "Claim tokens from the testnet faucet", xp: 10, icon: "🚰", category: "everyone", difficulty: "beginner", verification: "on_chain", season: 1 },
    { id: "read-docs", title: "Scholar", description: "Visit the Gno documentation site", xp: 10, icon: "📚", category: "everyone", difficulty: "beginner", verification: "off_chain", season: 1 },

    // DAO Participation (10)
    { id: "join-dao", title: "DAO Member", description: "Join any DAO (via candidature or direct add)", xp: 25, icon: "🏛️", category: "everyone", difficulty: "intermediate", verification: "on_chain", season: 1 },
    { id: "create-dao", title: "DAO Founder", description: "Create your own DAO using Memba", xp: 30, icon: "🏗️", category: "everyone", difficulty: "intermediate", verification: "on_chain", season: 1 },
    { id: "vote-proposal", title: "First Vote", description: "Cast your first vote on a DAO proposal", xp: 20, icon: "🗳️", category: "everyone", difficulty: "beginner", verification: "on_chain", season: 1 },
    { id: "create-proposal", title: "Proposal Author", description: "Create a governance proposal", xp: 25, icon: "📜", category: "everyone", difficulty: "intermediate", verification: "on_chain", season: 1 },
    { id: "vote-5-proposals", title: "Active Voter", description: "Vote on 5 different proposals", xp: 30, icon: "🗳️", category: "everyone", difficulty: "intermediate", verification: "on_chain", prerequisite: "vote-proposal", season: 1 },
    { id: "execute-proposal", title: "Executor", description: "Execute an approved proposal", xp: 25, icon: "⚡", category: "everyone", difficulty: "intermediate", verification: "on_chain", prerequisite: "vote-proposal", season: 1 },
    { id: "post-board", title: "Forum Poster", description: "Post a message on a DAO board", xp: 15, icon: "📝", category: "everyone", difficulty: "beginner", verification: "on_chain", season: 1 },
    { id: "reply-board", title: "Conversationalist", description: "Reply to a board post", xp: 10, icon: "💬", category: "everyone", difficulty: "beginner", verification: "on_chain", prerequisite: "post-board", season: 1 },
    { id: "browse-proposals", title: "Governance Viewer", description: "Browse a DAO's proposals page", xp: 15, icon: "📋", category: "everyone", difficulty: "beginner", verification: "off_chain", season: 1 },
    { id: "submit-candidature", title: "Applicant", description: "Submit a candidature to join a DAO", xp: 20, icon: "📨", category: "everyone", difficulty: "intermediate", verification: "on_chain", season: 1 },

    // Token & NFT (5)
    { id: "create-token", title: "Token Minter", description: "Create a GRC20 token using the token factory", xp: 25, icon: "🪙", category: "everyone", difficulty: "intermediate", verification: "on_chain", season: 1 },
    { id: "send-tokens", title: "Token Sender", description: "Send tokens to another address", xp: 15, icon: "📤", category: "everyone", difficulty: "beginner", verification: "on_chain", season: 1 },
    { id: "mint-nft", title: "NFT Collector", description: "Mint or buy your first NFT", xp: 20, icon: "🖼️", category: "everyone", difficulty: "intermediate", verification: "on_chain", season: 1 },
    { id: "list-nft", title: "NFT Trader", description: "List an NFT for sale on the marketplace", xp: 20, icon: "🏷️", category: "everyone", difficulty: "intermediate", verification: "on_chain", prerequisite: "mint-nft", season: 1 },
    { id: "hold-5-tokens", title: "Portfolio Builder", description: "Hold 5+ different GRC20 tokens", xp: 25, icon: "💼", category: "everyone", difficulty: "intermediate", verification: "on_chain", season: 1 },

    // Social & Community (5)
    { id: "follow-twitter", title: "Gno Follower", description: "Follow @_gnoland on Twitter/X", xp: 10, icon: "🐦", category: "everyone", difficulty: "beginner", verification: "social", season: 1 },
    { id: "join-discord", title: "Community Member", description: "Join the Gno Discord server", xp: 10, icon: "💜", category: "everyone", difficulty: "beginner", verification: "social", season: 1 },
    { id: "share-link", title: "Ambassador", description: "Share a Memba link with someone", xp: 10, icon: "🔗", category: "everyone", difficulty: "beginner", verification: "off_chain", season: 1 },
    { id: "submit-feedback", title: "Voice Heard", description: "Submit feedback via the Feedback page", xp: 20, icon: "📣", category: "everyone", difficulty: "beginner", verification: "off_chain", season: 1 },
    { id: "invite-member", title: "Recruiter", description: "Invite someone to join your team via invite code", xp: 15, icon: "🤝", category: "everyone", difficulty: "beginner", verification: "off_chain", season: 1 },
]

// Category 3: Community Champion (~15 quests)

const CHAMPION_QUESTS: GnoQuest[] = [
    { id: "complete-all-everyone", title: "Completionist", description: "Complete all 'Everyone' quests", xp: 50, icon: "🏆", category: "champion", difficulty: "advanced", verification: "off_chain", season: 1 },
    { id: "top-10-leaderboard", title: "Top 10", description: "Reach the top 10 on the global leaderboard", xp: 50, icon: "🥇", category: "champion", difficulty: "expert", verification: "off_chain", season: 1 },
    { id: "earn-500-xp", title: "XP Hunter", description: "Accumulate 500 XP total", xp: 25, icon: "⭐", category: "champion", difficulty: "intermediate", verification: "off_chain", season: 1 },
    { id: "earn-1000-xp", title: "XP Master", description: "Accumulate 1,000 XP total", xp: 50, icon: "🌟", category: "champion", difficulty: "advanced", verification: "off_chain", prerequisite: "earn-500-xp", season: 1 },
    { id: "3-dao-member", title: "Multi-DAO", description: "Be a member of 3+ different DAOs", xp: 35, icon: "🏛️", category: "champion", difficulty: "intermediate", verification: "on_chain", prerequisite: "join-dao", season: 1 },
    { id: "create-team", title: "Team Captain", description: "Create a team and have 3+ members join", xp: 30, icon: "👥", category: "champion", difficulty: "intermediate", verification: "off_chain", season: 1 },
    { id: "10-board-posts", title: "Prolific Poster", description: "Write 10+ board posts across DAOs", xp: 30, icon: "📝", category: "champion", difficulty: "intermediate", verification: "on_chain", prerequisite: "post-board", season: 1 },
    { id: "treasury-contributor", title: "Generous", description: "Contribute funds to a DAO treasury", xp: 25, icon: "💰", category: "champion", difficulty: "intermediate", verification: "on_chain", season: 1 },
    { id: "gnolove-top-20", title: "Open Source Star", description: "Be in the Gnolove top 20 contributors", xp: 40, icon: "💖", category: "champion", difficulty: "expert", verification: "off_chain", season: 1 },
    { id: "ai-report-reader", title: "Data-Driven", description: "Read 5 AI governance reports for different DAOs", xp: 20, icon: "🤖", category: "champion", difficulty: "beginner", verification: "off_chain", season: 1 },
    { id: "multisig-signer", title: "Co-Signer", description: "Participate in a multisig transaction signing", xp: 30, icon: "✍️", category: "champion", difficulty: "intermediate", verification: "on_chain", season: 1 },
    { id: "channel-active", title: "Chat Champion", description: "Send 20+ messages in DAO channels", xp: 25, icon: "💬", category: "champion", difficulty: "intermediate", verification: "on_chain", season: 1 },
    { id: "weekly-login", title: "Dedicated", description: "Log in to Memba 7 days in a row", xp: 20, icon: "📅", category: "champion", difficulty: "beginner", verification: "off_chain", season: 1 },
    { id: "help-newcomer", title: "Welcomer", description: "Reply to a newcomer's first board post", xp: 15, icon: "👋", category: "champion", difficulty: "beginner", verification: "on_chain", season: 1 },
    { id: "validator-delegator", title: "Staker", description: "Delegate GNOT to a validator", xp: 30, icon: "🥩", category: "champion", difficulty: "intermediate", verification: "on_chain", season: 1 },
]

// Category 4: Hidden & Seasonal (~10 quests)

const HIDDEN_QUESTS: GnoQuest[] = [
    { id: "easter-egg-konami", title: "Retro Gamer", description: "Enter the Konami code on any Memba page", xp: 15, icon: "🎮", category: "hidden", difficulty: "beginner", verification: "off_chain", hidden: true, season: 1 },
    { id: "night-owl", title: "Night Owl", description: "Complete a quest between 2 AM and 5 AM local time", xp: 10, icon: "🦉", category: "hidden", difficulty: "beginner", verification: "off_chain", hidden: true, season: 1 },
    { id: "speed-runner", title: "Speed Runner", description: "Complete 5 quests in a single session (< 1 hour)", xp: 25, icon: "⚡", category: "hidden", difficulty: "intermediate", verification: "off_chain", hidden: true, season: 1 },
    { id: "first-100-users", title: "Early Adopter", description: "Be among the first 100 users to connect a wallet", xp: 50, icon: "🥇", category: "hidden", difficulty: "beginner", verification: "off_chain", hidden: true, season: 1 },
    { id: "perfect-week", title: "Perfect Week", description: "Complete at least 1 quest every day for 7 days", xp: 30, icon: "🗓️", category: "hidden", difficulty: "intermediate", verification: "off_chain", hidden: true, season: 1 },
    { id: "directory-deep-dive", title: "Deep Diver", description: "Visit every tab in the Directory + view 10 DAOs", xp: 20, icon: "🤿", category: "hidden", difficulty: "beginner", verification: "off_chain", hidden: true, season: 1 },
    { id: "all-networks", title: "Network Master", description: "Connect to all available networks", xp: 25, icon: "🌍", category: "hidden", difficulty: "beginner", verification: "off_chain", hidden: true, season: 1 },
    { id: "genesis-dao-voter", title: "Genesis Voter", description: "Vote on a proposal in the first DAO created on a new chain", xp: 35, icon: "🏁", category: "hidden", difficulty: "intermediate", verification: "on_chain", hidden: true, season: 1 },
    { id: "bug-hunter", title: "Bug Hunter", description: "Report a verified bug via the feedback system", xp: 40, icon: "🐛", category: "hidden", difficulty: "intermediate", verification: "self_report", hidden: true, season: 1 },
    { id: "season-1-complete", title: "Season 1 Legend", description: "Complete 50+ quests during Season 1", xp: 100, icon: "🏆", category: "hidden", difficulty: "expert", verification: "off_chain", hidden: true, season: 1 },
]

// ── Aggregated Quest Registry ───────────────────────────────

export const ALL_QUESTS: GnoQuest[] = [
    ...DEVELOPER_QUESTS,
    ...EVERYONE_QUESTS,
    ...CHAMPION_QUESTS,
    ...HIDDEN_QUESTS,
]

/** Quest count by category */
export const QUEST_COUNTS = {
    developer: DEVELOPER_QUESTS.length,
    everyone: EVERYONE_QUESTS.length,
    champion: CHAMPION_QUESTS.length,
    hidden: HIDDEN_QUESTS.length,
    total: ALL_QUESTS.length,
}

/** Total possible XP (excluding hidden quests from display count) */
export const TOTAL_POSSIBLE_XP_V2 = ALL_QUESTS.reduce((sum, q) => sum + q.xp, 0)

/** Visible quests (exclude hidden until discovered) */
export function getVisibleQuests(completedIds: Set<string>): GnoQuest[] {
    return ALL_QUESTS.filter(q => {
        // Hidden quests only visible if completed or prerequisite is met
        if (q.hidden) {
            if (completedIds.has(q.id)) return true
            if (q.prerequisite && completedIds.has(q.prerequisite)) return true
            return false
        }
        return true
    })
}

/** Get quests by category */
export function getQuestsByCategory(category: QuestCategory): GnoQuest[] {
    return ALL_QUESTS.filter(q => q.category === category)
}

/** Get quest by ID */
export function getQuestById(id: string): GnoQuest | undefined {
    return ALL_QUESTS.find(q => q.id === id)
}

/** Check if a quest's prerequisite is satisfied */
export function isQuestAvailable(questId: string, completedIds: Set<string>): boolean {
    const quest = getQuestById(questId)
    if (!quest) return false
    if (quest.prerequisite && !completedIds.has(quest.prerequisite)) return false
    return !completedIds.has(questId) // not already completed
}

/** Build a map of quest ID → XP for backend validation */
export function buildQuestXPMap(): Record<string, number> {
    const map: Record<string, number> = {}
    for (const q of ALL_QUESTS) {
        map[q.id] = q.xp
    }
    return map
}
