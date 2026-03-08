/**
 * Command definitions for the Cmd+K command palette.
 */

export interface Command {
    id: string
    label: string
    icon: string
    path: string
    section: string
    keywords?: string[]
}

export const COMMANDS: Command[] = [
    // Navigation
    { id: "home", label: "Home", icon: "🏠", path: "/", section: "Navigation", keywords: ["landing", "start"] },
    { id: "dashboard", label: "Dashboard", icon: "📊", path: "/dashboard", section: "Navigation", keywords: ["overview", "hub"] },
    { id: "settings", label: "Settings", icon: "⚙️", path: "/settings", section: "Navigation", keywords: ["config", "preferences", "network"] },

    // DAO
    { id: "daos", label: "My DAOs", icon: "🏛️", path: "/dao", section: "DAO", keywords: ["governance", "organization", "list"] },
    { id: "create-dao", label: "Create DAO", icon: "➕", path: "/dao/create", section: "DAO", keywords: ["new", "deploy", "factory"] },

    // Tokens
    { id: "tokens", label: "Token Launchpad", icon: "🪙", path: "/tokens", section: "Tokens", keywords: ["grc20", "mint", "create"] },
    { id: "create-token", label: "Create Token", icon: "💎", path: "/create-token", section: "Tokens", keywords: ["mint", "deploy", "grc20"] },

    // Multisig
    { id: "create-multisig", label: "Create Multisig", icon: "🔑", path: "/create", section: "Multisig", keywords: ["wallet", "new"] },
    { id: "import-multisig", label: "Import Multisig", icon: "📥", path: "/import", section: "Multisig", keywords: ["wallet", "join", "link"] },

    // Explore
    { id: "directory", label: "Directory", icon: "📂", path: "/directory", section: "Explore", keywords: ["discover", "search", "browse", "daos", "tokens", "users"] },
    { id: "validators", label: "Validators", icon: "⚡", path: "/validators", section: "Explore", keywords: ["network", "staking", "nodes"] },
    { id: "extensions", label: "Extensions", icon: "🧩", path: "/extensions", section: "Explore", keywords: ["plugins", "swap", "leaderboard", "proposals", "channels", "gnoswap"] },

    // Profile
    { id: "profile", label: "My Profile", icon: "👤", path: "/profile", section: "Profile", keywords: ["account", "bio", "votes"] },
    { id: "feedback", label: "Feedback", icon: "📣", path: "/feedback", section: "Profile", keywords: ["bug", "report", "suggest", "help"] },
]
