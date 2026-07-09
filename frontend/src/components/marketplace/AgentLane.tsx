import { useState, useEffect } from "react"
import { fetchAgents, type AgentListing } from "../../lib/agentRegistry"
import { nftFallbackUri } from "../../lib/nftFallbackArt"
import { DeployAgentModal } from "./DeployAgentModal"

export default function AgentLane() {
    const [agents, setAgents] = useState<AgentListing[]>([])
    const [loading, setLoading] = useState(true)
    const [deployingAgent, setDeployingAgent] = useState<AgentListing | null>(null)

    useEffect(() => {
        let mounted = true
        fetchAgents().then(data => {
            if (mounted) {
                setAgents(data)
                setLoading(false)
            }
        }).catch(err => {
            console.error("Failed to fetch agents:", err)
            if (mounted) setLoading(false)
        })
        return () => { mounted = false }
    }, [])

    if (loading) {
        return <div className="um-lane-loading animate-pulse">Loading AI Agents...</div>
    }

    return (
        <div className="animate-fade-in">
            <div className="um-lane-header">
                <h2 className="um-lane-title">AI Agent Network</h2>
            </div>
            
            <div className="um-grid">
                {agents.map(agent => (
                    <div key={agent.id} className="k-card" style={{ display: "flex", flexDirection: "column", padding: 0, overflow: "hidden", border: "1px solid var(--color-border)" }}>
                        <div style={{ width: "100%", height: "140px", position: "relative", backgroundColor: "var(--color-bg-tertiary)", overflow: "hidden" }}>
                            <img src={nftFallbackUri(agent.id)} alt={agent.name} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.8 }} />
                            <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "48px", background: "linear-gradient(to top, var(--color-bg-primary), transparent)" }}>
                                🤖
                            </div>
                        </div>
                        <div style={{ padding: "24px", flex: 1, display: "flex", flexDirection: "column" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: "20px", color: "var(--color-text)", display: "flex", alignItems: "center", gap: "8px" }}>
                                        {agent.name}
                                        {/* Verified/reputation badges intentionally removed here: they were sourced from
                                            mock SEED_AGENTS data (fabricated trust signal). Reintroduced in Phase 6, read
                                            ONLY from the authoritative, purchase-gated reputation realm keyed by address. */}
                                    </h3>
                                    <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "4px" }}>
                                        by {agent.creatorName || agent.creator.slice(0, 8)}
                                    </div>
                                </div>
                                <span style={{ fontSize: "12px", background: "var(--color-bg-tertiary)", padding: "4px 8px", borderRadius: "12px", color: "var(--color-text-muted)" }}>
                                    {agent.category}
                                </span>
                            </div>
                            
                            <p style={{ fontSize: "14px", color: "var(--color-text-muted)", marginBottom: "24px", flex: 1, lineHeight: 1.5 }}>
                                {agent.description}
                            </p>
                            
                            <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "16px", marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                                <div>
                                    <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginBottom: "4px" }}>Pricing</div>
                                    <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text)" }}>
                                        {agent.pricing === "free" ? "Free" : `${agent.pricePerCall} GNOT / call`}
                                    </div>
                                </div>
                                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", textAlign: "right" }}>
                                    <div>{agent.totalCalls.toLocaleString()} calls</div>
                                    {/* Star rating removed: it was fabricated from mock SEED_AGENTS and was not
                                        purchase-gated. Reputation returns in Phase 6 from the authoritative realm. */}
                                </div>
                            </div>

                            <button className="k-btn-primary" style={{ width: "100%" }} onClick={() => setDeployingAgent(agent)}>
                                Deploy Agent
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {deployingAgent && (
                <DeployAgentModal 
                    agent={deployingAgent}
                    onClose={() => setDeployingAgent(null)}
                    onSuccess={() => {
                        setDeployingAgent(null)
                        alert(`Success! Credits purchased for ${deployingAgent.name}.`)
                    }}
                />
            )}
        </div>
    )
}
