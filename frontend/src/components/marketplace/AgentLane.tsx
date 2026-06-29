import { useState, useEffect } from "react"
import { useNetworkPath } from "../../hooks/useNetworkNav"
import { fetchAgents, type AgentListing } from "../../lib/agentRegistry"

export default function AgentLane() {
    const np = useNetworkPath()
    const [agents, setAgents] = useState<AgentListing[]>([])
    const [loading, setLoading] = useState(true)

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
                        <div style={{ padding: "24px", flex: 1, display: "flex", flexDirection: "column" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: "20px", color: "var(--color-text)", display: "flex", alignItems: "center", gap: "8px" }}>
                                        {agent.name}
                                        {agent.verified && <span style={{ color: "var(--color-primary)", fontSize: "14px" }}>✓</span>}
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
                                    <div>★ {agent.rating.toFixed(1)} ({agent.ratingCount})</div>
                                </div>
                            </div>

                            <button className="k-btn-primary" style={{ width: "100%" }} onClick={() => alert("Agent deployment modal coming soon!")}>
                                Deploy Agent
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
