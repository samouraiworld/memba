/**
 * PluginPage — Route handler for /dao/:slug/plugin/:pluginId
 *
 * Extracts the DAO slug and plugin ID from URL params,
 * resolves the realm path, and delegates to PluginLoader.
 *
 * @module pages/PluginPage
 */

import { useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import type { LayoutContext } from "../types/layout"
import { useDaoRoute } from "../hooks/useDaoRoute"
import { PluginLoader } from "../plugins/PluginLoader"

export function PluginPage() {
    const { realmPath, encodedSlug, pluginId } = useDaoRoute()
    const navigate = useNetworkNav()
    const { auth, adena } = useOutletContext<LayoutContext>()

    if (!realmPath || !pluginId) {
        navigate("/dao")
        return null
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Back navigation */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                    onClick={() => navigate(`/dao/${encodedSlug}`)}
                    style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: "var(--color-primary)", fontSize: 12,
                        fontFamily: "JetBrains Mono, monospace",
                    }}
                >
                    ← Back to DAO
                </button>
            </div>

            {/* Plugin content */}
            <PluginLoader
                pluginId={pluginId}
                pluginProps={{
                    realmPath,
                    slug: encodedSlug,
                    auth,
                    adena,
                }}
            />
        </div>
    )
}
