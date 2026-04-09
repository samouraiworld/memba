/**
 * PluginLoader — Lazy-loading wrapper for plugin components.
 *
 * Handles Suspense, error boundaries, and PluginProps injection.
 * All plugin loaders are pre-built at module level (outside render)
 * to satisfy react-hooks/static-components.
 */

import { lazy, Suspense, Component, type ReactNode, type ComponentType } from "react"
import { getPlugins, getPlugin } from "./registry"
import type { PluginProps } from "./types"

// ── Error Boundary ──────────────────────────────────────────────

interface ErrorState {
    hasError: boolean
    error: Error | null
}

class PluginErrorBoundary extends Component<{ pluginId: string; children: ReactNode }, ErrorState> {
    state: ErrorState = { hasError: false, error: null }

    static getDerivedStateFromError(error: Error): ErrorState {
        return { hasError: true, error }
    }

    render() {
        if (this.state.hasError) {
            return (
                <div
                    id={`plugin-error-${this.props.pluginId}`}
                    style={{
                        padding: "20px 24px",
                        borderRadius: 10,
                        background: "rgba(255,59,48,0.05)",
                        border: "1px solid rgba(255,59,48,0.15)",
                        fontFamily: "JetBrains Mono, monospace",
                    }}
                >
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-danger)", marginBottom: 6 }}>
                        ⚠️ Plugin failed to load
                    </div>
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                        Plugin &quot;{this.props.pluginId}&quot; encountered an error.
                        {this.state.error?.message && (
                            <span style={{ display: "block", marginTop: 4, color: "var(--color-text-muted)" }}>
                                {this.state.error.message}
                            </span>
                        )}
                    </div>
                </div>
            )
        }
        return this.props.children
    }
}

// ── Shimmer Fallback ────────────────────────────────────────────

function PluginShimmer() {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 0" }}>
            {[1, 2].map(i => (
                <div
                    key={i}
                    className="k-shimmer"
                    style={{ height: 60, borderRadius: 8, background: "var(--color-border)" }}
                />
            ))}
        </div>
    )
}

// ── Not Found fallback ──────────────────────────────────────────

function PluginNotFound({ pluginId }: { pluginId: string }) {
    return (
        <div
            id={`plugin-not-found-${pluginId}`}
            style={{
                padding: "20px 24px",
                borderRadius: 10,
                background: "rgba(245,166,35,0.05)",
                border: "1px solid rgba(245,166,35,0.15)",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 12,
                color: "var(--color-warning)",
            }}
        >
            ⚠️ Plugin &quot;{pluginId}&quot; not found in registry.
        </div>
    )
}

// ── Pre-built lazy components (module-level) ────────────────────

const LAZY_PLUGINS: Record<string, React.LazyExoticComponent<ComponentType<PluginProps>>> =
    Object.fromEntries(
        getPlugins().map(p => [p.id, lazy(p.component)])
    )

// ── Loader Components (one per plugin, pre-built at module level) ──
// Each is a named, static component — no dynamic creation during render.

const LOADER_COMPONENTS: Record<string, ComponentType<{ pluginProps: PluginProps }>> =
    Object.fromEntries(
        Object.entries(LAZY_PLUGINS).map(([id, LazyPlugin]) => {
            function PluginInstanceLoader({ pluginProps }: { pluginProps: PluginProps }) {
                return (
                    <PluginErrorBoundary pluginId={id}>
                        <Suspense fallback={<PluginShimmer />}>
                            <LazyPlugin {...pluginProps} />
                        </Suspense>
                    </PluginErrorBoundary>
                )
            }
            return [id, PluginInstanceLoader]
        })
    )

// ── Public API ──────────────────────────────────────────────────

interface PluginLoaderProps {
    /** Plugin ID to load. */
    pluginId: string
    /** Props to pass to the loaded plugin component. */
    pluginProps: PluginProps
}

/**
 * Renders a plugin by its registry ID.
 * Delegates to a pre-built, static loader component.
 */
export function PluginLoader({ pluginId, pluginProps }: PluginLoaderProps) {
    // Lookup is a plain object property access — not a component creation
    const LoaderComponent = LOADER_COMPONENTS[pluginId]

    if (!LoaderComponent || !getPlugin(pluginId)) {
        return <PluginNotFound pluginId={pluginId} />
    }

    return <LoaderComponent pluginProps={pluginProps} />
}
