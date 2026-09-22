/** Editorial references, separate from registry listings and realm eligibility.
 * Evidence: docs/design/professional-mainnet-2026-09/ECOSYSTEM-SOURCES.md.
 */
export const ECOSYSTEM_CATEGORIES = ["Wallet", "Exchange", "Community", "Creative worlds", "Explorer", "Developer tools"] as const
export type EcosystemCategory = typeof ECOSYSTEM_CATEGORIES[number]
export type EcosystemNetwork = "mainnet" | "staging"
export interface EcosystemProject {
    id: string
    name: string
    category: EcosystemCategory
    description: string
    status: string
    url: string
    kind: "app" | "tool"
    /** Observed read access or network selection; never transaction readiness. */
    networks: readonly EcosystemNetwork[]
    availability: string
    evidence: { url: string; checkedAt: string }
    sourceUrl?: string
    realm?: { path: string; network: EcosystemNetwork; url: string }
}
export const ECOSYSTEM_PROJECTS: readonly EcosystemProject[] = [
    { id: "adena", name: "Adena", category: "Wallet", kind: "tool", networks: [],
        url: "https://www.adena.app/", status: "Browser wallet", availability: "External tool · choose a network in the wallet",
        description: "Manage your Gno accounts and connect to apps with a browser extension.",
        evidence: { url: "https://docs.gno.land/users/third-party-wallets/", checkedAt: "2026-09-22" } },
    { id: "gnoswap", name: "GnoSwap", category: "Exchange", kind: "app", networks: [],
        url: "https://gnoswap.io/", status: "Exchange", availability: "Network not verified",
        description: "Explore token swaps and liquidity pools built for the Gno ecosystem.",
        sourceUrl: "https://github.com/gnoswap-labs/gnoswap",
        evidence: { url: "https://gnoswap.io/", checkedAt: "2026-09-22" } },
    { id: "boards", name: "Boards", category: "Community", kind: "app", networks: ["mainnet"],
        url: "https://gno.land/r/gnoland/boards2/v0", status: "On-chain forum", availability: "Mainnet · read access checked",
        description: "Read community discussions on Gno and explore the forum’s public source.",
        sourceUrl: "https://gno.land/r/gnoland/boards2/v0$source",
        realm: { path: "gno.land/r/gnoland/boards2/v0", network: "mainnet", url: "https://gno.land/r/gnoland/boards2/v0" },
        evidence: { url: "https://gno.land/r/gnoland/boards2/v0", checkedAt: "2026-09-22" } },
    { id: "akkadia", name: "Akkadia", category: "Creative worlds", kind: "app", networks: [],
        url: "https://abp.akkadia.land/", status: "Builder preview", availability: "Network not verified",
        description: "Discover a preview of a sandbox for creating shared worlds on Gno.",
        evidence: { url: "https://abp.akkadia.land/", checkedAt: "2026-09-22" } },
    { id: "gnoscan", name: "GnoScan", category: "Explorer", kind: "tool", networks: ["mainnet", "staging"],
        url: "https://gnoscan.io/", status: "Network explorer", availability: "Mainnet / Staging · select in explorer",
        description: "Look up accounts, transactions, blocks, and realms across Gno networks.",
        evidence: { url: "https://gnoscan.io/", checkedAt: "2026-09-22" } },
    { id: "playground", name: "Gno Playground", category: "Developer tools", kind: "tool", networks: [],
        url: "https://play.gno.land/", status: "Browser workspace", availability: "Sandbox · no chain deployment implied",
        description: "Write, run, and share Gno code directly in your browser.",
        evidence: { url: "https://play.gno.land/", checkedAt: "2026-09-22" } },
    { id: "mygnoscan", name: "mygnoscan", category: "Explorer", kind: "tool", networks: ["mainnet"],
        url: "https://mygnoscan.moul.p2p.team/storage?network=mainnet", status: "Storage explorer", availability: "Mainnet · opens mainnet view",
        description: "Explore indexed realms and storage on mainnet using an independent explorer.",
        sourceUrl: "https://github.com/gnoverse/mygnoscan",
        evidence: { url: "https://mygnoscan.moul.p2p.team/storage?network=mainnet", checkedAt: "2026-09-22" } },
]
export const ECOSYSTEM_AVAILABILITY = ["all", "mainnet", "testnet", "tools", "unknown"] as const
export type EcosystemAvailability = typeof ECOSYSTEM_AVAILABILITY[number]
export interface EcosystemFilters { q: string; category: EcosystemCategory | "all"; availability: EcosystemAvailability }
export function filterEcosystemProjects(filters: EcosystemFilters): readonly EcosystemProject[] {
    const q = filters.q.trim().toLowerCase()
    return ECOSYSTEM_PROJECTS.filter(project => {
        if (filters.category !== "all" && project.category !== filters.category) return false
        if (filters.availability === "mainnet" && !project.networks.includes("mainnet")) return false
        if (filters.availability === "testnet" && !project.networks.includes("staging")) return false
        if (filters.availability === "tools" && project.kind !== "tool") return false
        if (filters.availability === "unknown" && (project.kind === "tool" || project.networks.length > 0)) return false
        return [project.name, project.description, project.category, project.realm?.path ?? ""].some(value => value.toLowerCase().includes(q))
    })
}
