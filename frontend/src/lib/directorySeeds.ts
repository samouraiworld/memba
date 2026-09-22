import { NETWORKS } from "./config"
import type { DirectoryPackage, DirectoryRealm } from "./directory"

// Historical references. They are not evidence of deployment on any current chain.
/** Well-known standard library and community packages on gno.land. */
export const SEED_PACKAGES: DirectoryPackage[] = [
    { name: "GRC20", path: "gno.land/p/demo/grc/grc20", description: "Fungible token standard (ERC-20 equivalent)" },
    { name: "GRC721", path: "gno.land/p/demo/grc/grc721", description: "Non-fungible token standard (ERC-721 equivalent)" },
    { name: "GRC1155", path: "gno.land/p/demo/grc/grc1155", description: "Multi-token standard" },
    { name: "AVL Tree", path: "gno.land/p/demo/avl", description: "Self-balancing binary search tree" },
    { name: "DAO", path: "gno.land/p/demo/dao", description: "Core DAO primitives (proposals, votes)" },
    { name: "Ownable", path: "gno.land/p/demo/ownable", description: "Ownership management pattern" },
    { name: "Pausable", path: "gno.land/p/demo/pausable", description: "Contract pause/unpause pattern" },
    { name: "Seqid", path: "gno.land/p/demo/seqid", description: "Sequential ID generator" },
    { name: "uassert", path: "gno.land/p/demo/uassert", description: "Assertion helpers for testing" },
    { name: "ufmt", path: "gno.land/p/demo/ufmt", description: "String formatting utilities" },
    { name: "json", path: "gno.land/p/demo/json", description: "JSON parser and builder" },
    { name: "Membstore", path: "gno.land/p/demo/membstore", description: "DAO member storage" },
    { name: "Simpledao", path: "gno.land/p/demo/simpledao", description: "Simple DAO implementation" },
    { name: "Entropy", path: "gno.land/p/demo/entropy", description: "Pseudo-random number generation" },
    { name: "Boards", path: "gno.land/p/demo/boards2", description: "Discussion board framework" },
]

/** Historical realm references; current deployment is not established. */
export const SEED_REALMS: DirectoryRealm[] = [
    { name: "GRC20 Registry", path: "gno.land/r/demo/grc20reg", description: "Token registry — lists all GRC20 tokens", category: "standard" },
    { name: "User Registry", path: "gno.land/r/sys/users", description: "On-chain username registry", category: "standard" },
    { name: "GnoSwap", path: "gno.land/r/gnoswap/v1/router", description: "Decentralized token exchange", category: "defi" },
    { name: "GRC20 Factory", path: "gno.land/r/samcrew/tokenfactory_v2", description: "Deploy new GRC20 tokens", category: "defi" },
    { name: "Boards v2", path: "gno.land/r/gnoland/boards2/v1", description: "Discussion boards with threads", category: "social" },
    { name: "Blog", path: "gno.land/r/gnoland/blog", description: "Official gno.land blog", category: "social" },
    { name: "Faucet", path: "gno.land/r/gnoland/faucet", description: "Faucet for ugnot", category: "utility" },
    { name: "GovDAO", path: "gno.land/r/gov/dao", description: "Chain governance DAO", category: "standard" },
    { name: "GovDAO v2", path: "gno.land/r/gov/dao/v2", description: "Governance DAO v2", category: "standard" },
    { name: "Worx", path: "gno.land/r/demo/worx", description: "Community workspace DAO", category: "social" },
    { name: "Faucet Admin", path: "gno.land/r/faucet/admin", description: "Faucet administration realm", category: "utility" },
]


// Checked against gnoland-1 source pages on 2026-09-22. All 15 historical
// p/demo package URLs returned 404; do not present them as mainnet packages.
const MAINNET_REALMS: DirectoryRealm[] = [
    { name: "Boards", path: "gno.land/r/gnoland/boards2/v0", description: "Community discussion boards", category: "social" },
    { name: "GovDAO", path: "gno.land/r/gov/dao", description: "Chain governance DAO", category: "standard" },
    { name: "Blog", path: "gno.land/r/gnoland/blog", description: "Official gno.land blog", category: "social" },
]

export function directorySeeds(networkKey: string): { packages: DirectoryPackage[]; realms: DirectoryRealm[] } {
    if (!NETWORKS[networkKey]) return { packages: [], realms: [] }
    const mainnet = networkKey === "mainnet"
    const metadata = { networkKey, provenance: mainnet ? "editorial" as const : "reference" as const, checkedAt: mainnet ? "2026-09-22" : undefined }
    return {
        packages: (mainnet ? [] : SEED_PACKAGES).map(item => ({ ...item, ...metadata })),
        realms: (mainnet ? MAINNET_REALMS : SEED_REALMS).map(item => ({ ...item, ...(item.name === "User Registry" ? { path: NETWORKS[networkKey].userRegistryPath } : {}), ...metadata })),
    }
}
