/**
 * Plugin System — Public API
 *
 * Barrel export for the Memba plugin architecture.
 */

export { getPlugins, getPlugin } from "./registry"
export { PluginLoader } from "./PluginLoader"
export type { PluginManifest, PluginProps } from "./types"
