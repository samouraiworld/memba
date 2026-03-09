/**
 * Plugin Architecture — Type Definitions
 *
 * Core interfaces for the Memba plugin system (v2.0-α).
 * All plugins must conform to PluginManifest.
 * All plugin components receive PluginProps.
 */

import type { LayoutContext } from "../types/layout"

// ── Manifest ────────────────────────────────────────────────────

/** Describes a single plugin extension registered in the system. */
export interface PluginManifest {
    /** Unique identifier, e.g. "proposals". Must be URL-safe. */
    readonly id: string
    /** Human-readable name shown in the UI. */
    readonly name: string
    /** Emoji or icon string for display. */
    readonly icon: string
    /** Sub-route under /dao/:slug/, e.g. "proposals". */
    readonly route: string
    /** Short description for tooltip/card. */
    readonly description: string
    /** Semver version of this plugin. */
    readonly version: string
    /** Lazy loader returning the default-exported React component. */
    readonly component: () => Promise<{ default: React.ComponentType<PluginProps> }>
}

// ── Props ───────────────────────────────────────────────────────

/** Props injected into every plugin component by the PluginLoader. */
export interface PluginProps {
    /** Fully-qualified realm path, e.g. "gno.land/r/user/mydao". */
    readonly realmPath: string
    /** URL-safe slug for the DAO. */
    readonly slug: string
    /** Auth context (token, isAuthenticated, address). */
    readonly auth: LayoutContext["auth"]
    /** Adena wallet context (connected, address, sign, etc.). */
    readonly adena: LayoutContext["adena"]
}
