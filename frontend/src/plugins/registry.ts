/**
 * Plugin Registry — Immutable, type-safe plugin catalog.
 *
 * Provides a frozen set of built-in plugins and lookup helpers.
 * Future: dynamic registration for third-party plugins.
 */

import type { PluginManifest } from "./types"

// ── Built-in Plugins ────────────────────────────────────────────

/** Core plugins shipped with Memba. Frozen at startup. */
export const BUILT_IN_PLUGINS: readonly PluginManifest[] = Object.freeze([
    {
        id: "proposals",
        name: "Proposal Explorer",
        icon: "📋",
        route: "proposals",
        description: "Search, filter, and manage DAO governance proposals",
        version: "2.0.0",
        component: () => import("./proposals/index").then(m => ({ default: m.default })),
    },
    {
        id: "board",
        name: "Board",
        icon: "💬",
        route: "board",
        description: "DAO discussion forum — channels, threads, and replies",
        version: "1.0.0",
        component: () => import("./board/index").then(m => ({ default: m.default })),
    },
    {
        id: "gnoswap",
        name: "GnoSwap",
        icon: "🔄",
        route: "swap",
        description: "DEX integration — swap tokens, add liquidity, manage pools",
        version: "1.0.0",
        component: () => import("./gnoswap/index").then(m => ({ default: m.default })),
    },
    {
        id: "leaderboard",
        name: "Leaderboard",
        icon: "🏆",
        route: "leaderboard",
        description: "Member ranking by on-chain contributions and governance participation",
        version: "1.0.0",
        component: () => import("./leaderboard/index").then(m => ({ default: m.default })),
    },
])

// ── Lookup Helpers ──────────────────────────────────────────────

/** Returns all registered plugins (built-in + future dynamic). */
export function getPlugins(): readonly PluginManifest[] {
    return BUILT_IN_PLUGINS
}

/** Lookup a single plugin by its unique ID. */
export function getPlugin(id: string): PluginManifest | undefined {
    return BUILT_IN_PLUGINS.find(p => p.id === id)
}

// ── Validation (dev-time safety) ────────────────────────────────

/** Validates that no duplicate IDs exist. Throws in dev builds. */
function validateRegistry(): void {
    const ids = new Set<string>()
    for (const p of BUILT_IN_PLUGINS) {
        if (ids.has(p.id)) {
            throw new Error(`[plugin-registry] Duplicate plugin ID: "${p.id}"`)
        }
        if (!p.id || !p.name || !p.icon || !p.route || !p.component) {
            throw new Error(`[plugin-registry] Invalid manifest for plugin: "${p.id}"`)
        }
        ids.add(p.id)
    }
}

// Run validation at module load (tree-shaken in production if unused)
validateRegistry()
