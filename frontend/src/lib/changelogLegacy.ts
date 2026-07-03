/**
 * changelogLegacy — curated pre-v6 entries (v2.6 → v3.2 era), preserved from
 * the old hardcoded /changelogs page. Everything v6.0.2+ flows from
 * CHANGELOG.md via lib/changelog.ts (W6.1); this file is frozen history and
 * needs no per-release edits.
 */
import type { ChangelogTag } from "./changelog"

export interface LegacyChangelogEntry {
    date: string
    version?: string
    title: string
    tags: ChangelogTag[]
    items: string[]
}

export const LEGACY_ENTRIES: LegacyChangelogEntry[] = [
    {
        date: "2026-04-06",
        version: "v3.2.0",
        title: "Multi-Model AI Consensus & Governance Discovery",
        tags: ["memba"],
        items: [
            "AI Governance Analyst: 10 free AI models analyze proposals from 10 perspectives (strategic, risk, technical, financial, legal, security, community, governance, reasoning, contrarian)",
            "DAO-level AI health insight: stat card with A+ through F grade, tooltip summary, expandable report",
            "On-demand analysis: click to trigger, cached 6 hours, never auto-fires",
            "Directory gnoweb integration: RealmDetailDrawer with Render/Source/Info tabs, syntax-highlighted Gno source code, cross-tab global search",
            "Token detail drawer in Directory for inline preview",
            "Proposal dates with hybrid tx-indexer + block estimation",
            "Candidature bridge: 3-state CandidatureUnlock linking Quest Hub to DAO membership",
            "Teams polish: copy invite code, confirmation dialogs, username resolution, team descriptions",
            "1,495 tests across 69 files",
        ],
    },
    {
        date: "2026-04-04",
        version: "v3.1.0",
        title: "NFT Marketplace, Launchpad & GRC1155",
        tags: ["memba"],
        items: [
            "NFT Gallery with 3-tab layout: Gallery, Marketplace, Activity",
            "NFT Launchpad: 5-step wizard for GRC721 and GRC1155 collections",
            "GRC1155 templates with per-token supply caps and URI metadata",
            "Agent Marketplace with on-chain registry + escrow realm",
            "Freelance Services UI with search, categories, demo listings",
        ],
    },
    {
        date: "2026-04-02",
        version: "v2.29.0",
        title: "Quest Hub Redesign + On-Chain Integration",
        tags: ["memba"],
        items: [
            "Quest Hub redesign with gamified UI and SVG radial ring",
            "RPC fallback resilience for gnoland1",
            "Admin Panel link in user profile",
            "1,400 tests across 62 files",
        ],
    },
    {
        date: "2026-03-28",
        version: "v2.26.0",
        title: "Teams, Candidature & Quest Integration",
        tags: ["memba"],
        items: [
            "Teams feature with workspace switching, invite codes, role management",
            "Candidature page for Memba DAO membership applications",
            "Quest system with 10 onboarding quests and XP tracking",
            "Marketplace and escrow realm deployed on test12",
        ],
    },
    {
        date: "2026-03-22",
        version: "v2.22.0",
        title: "Network URL Prefix & DAO Slash URLs",
        tags: ["memba"],
        items: [
            "Network-scoped URLs: /:network/dao/..., /:network/tokens/...",
            "DAO slash URL support for cleaner navigation",
            "Directory decomposition into 7 tab modules",
        ],
    },
    {
        date: "2026-03-19",
        version: "v2.15.0",
        title: "Gnoland1 + Smooth Network Switching",
        tags: ["memba"],
        items: [
            "Gnoland1 (Betanet) network now available in the dropdown — `rpc.gnoland1.samourai.live`",
            "Adena AddNetwork + SwitchNetwork integration: one-click wallet network switching",
            "Chain mismatch banner now offers 'Add & Switch Wallet' button",
            "Success toast on network switch",
            "What's New toast updated with gnoland1 info",
        ],
    },
    {
        date: "2026-03-18",
        version: "v2.14.0",
        title: "Testnet 12 Compatibility",
        tags: ["memba"],
        items: [
            "Testnet 12 is now the default network",
            "Auto-migration from test11 for existing users",
            "r/sys/users registry support (replaces r/gnoland/users/v1)",
            "Defensive username resolution for new Render formats",
            "Test12 added to trusted RPC domains and explorer URLs",
        ],
    },
    {
        date: "2026-03-18",
        title: "Testnet 12 Launch",
        tags: ["network", "gno-core"],
        items: [
            "New experimental testnet replacing test11",
            "Fresh genesis with new validator set",
            "r/sys/users replaces r/gnoland/users registry",
            "hCaptcha-based faucet at faucet.gno.land",
        ],
    },
    {
        date: "2026-03-14",
        title: "Betanet (gnoland1) Stable",
        tags: ["network"],
        items: [
            "First persistent Gno chain",
            "Production-grade — deploy with care",
            "Samourai Coop validators live: rpc.gnoland1.samourai.live",
        ],
    },
    {
        date: "2026-03-15",
        version: "v2.13.0",
        title: "Validators & Hacker Mode",
        tags: ["memba"],
        items: [
            "Validators dashboard with real-time consensus telemetry",
            "Hacker Mode with dual-RPC strategy",
            "Validator detail pages with uptime and participation metrics",
            "Sentry RPC integration for Samourai Coop nodes",
        ],
    },
    {
        date: "2026-03-12",
        version: "v2.12.0",
        title: "Extensions Hub & Plugin System",
        tags: ["memba"],
        items: [
            "Plugin registry with GnoSwap, Boards, Leaderboard",
            "Per-DAO plugin pages with dynamic routing",
            "Extensions Hub discovery page",
        ],
    },
    {
        date: "2026-03-10",
        version: "v2.11.0",
        title: "Creative Landing & DAO Channels",
        tags: ["memba"],
        items: [
            "Video showcase landing page with Remotion",
            "DAO Channels for threaded discussions",
            "Jitsi video calls with PiP overlay",
            "Feedback page for user input",
        ],
    },
    {
        date: "2026-03-08",
        version: "v2.6.0",
        title: "Hardening & OSS Preparation",
        tags: ["memba"],
        items: [
            "CSP security headers with strict domain allowlist",
            "RPC domain validation for all transactions",
            "Human-centric error translation layer",
            "Centralized gas configuration system",
            "754+ unit tests, 238+ E2E tests",
        ],
    },
]
