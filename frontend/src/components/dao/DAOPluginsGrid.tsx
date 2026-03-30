import { useNavigate } from "react-router-dom"
import { Vault } from "@phosphor-icons/react"
import { getPlugins } from "../../plugins"

interface DAOPluginsGridProps {
    encodedSlug: string
}

export function DAOTreasuryCard({ encodedSlug }: { encodedSlug: string }) {
    const navigate = useNavigate()

    return (
        <div className="k-card dao-treasury-card">
            <div className="dao-treasury-left">
                <span className="dao-treasury-icon"><Vault size={22} /></span>
                <div>
                    <div className="dao-treasury-title">Treasury</div>
                    <div className="dao-treasury-desc">View DAO assets and balances</div>
                </div>
            </div>
            <button
                onClick={() => navigate(`/dao/${encodedSlug}/treasury`)}
                className="dao-treasury-open-btn"
            >
                Open →
            </button>
        </div>
    )
}

export function DAOPluginsGrid({ encodedSlug }: DAOPluginsGridProps) {
    const navigate = useNavigate()
    const plugins = getPlugins()

    if (plugins.length === 0) return null

    return (
        <div>
            <h3 className="dao-extensions-title">
                🧩 Extensions
            </h3>
            <div className="dao-extensions-grid">
                {plugins.map(plugin => (
                    <div key={plugin.id} style={{ display: "flex", flexDirection: "column" }}>
                        <button
                            id={`plugin-card-${plugin.id}`}
                            onClick={() => navigate(`/dao/${encodedSlug}/plugin/${plugin.id}`)}
                            className="k-card dao-plugin-card"
                        >
                            <span className="dao-plugin-icon">{plugin.icon}</span>
                            <div className="dao-plugin-body">
                                <div className="dao-plugin-name-row">
                                    <span className="dao-plugin-name">{plugin.name}</span>
                                    <span className="dao-plugin-version">v{plugin.version}</span>
                                </div>
                                <div className="dao-plugin-desc">{plugin.description}</div>
                            </div>
                            <span className="dao-plugin-arrow">→</span>
                        </button>
                    </div>
                ))}
            </div>
        </div>
    )
}
