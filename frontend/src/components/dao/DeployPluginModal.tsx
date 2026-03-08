/**
 * DeployPluginModal — Lightweight modal for deploying Board plugin to existing DAOs.
 *
 * Shows channel configuration and triggers deployment via Adena DoContract.
 * Used from DAOHome when a plugin hasn't been deployed yet.
 */
import { useState } from "react"
import { generateBoardCode, buildDeployBoardMsg, defaultBoardConfig, isValidChannel } from "../../lib/boardTemplate"
import { getGasConfig } from "../../lib/gasConfig"
import { inputStyle } from "../dao/wizardShared"

interface Props {
    daoRealmPath: string
    daoName: string
    callerAddress: string
    onClose: () => void
    onDeployed: () => void
}

export function DeployPluginModal({ daoRealmPath, daoName, callerAddress, onClose, onDeployed }: Props) {
    const [channels, setChannels] = useState<string[]>(["general"])
    const [newChannel, setNewChannel] = useState("")
    const [channelError, setChannelError] = useState<string | null>(null)
    const [deploying, setDeploying] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const addChannel = () => {
        const name = newChannel.trim().toLowerCase()
        if (!name) return
        if (!isValidChannel(name)) { setChannelError("a-z, 0-9, _, - only"); return }
        if (channels.includes(name)) { setChannelError("Already exists"); return }
        if (channels.length >= 5) { setChannelError("Max 5 channels"); return }
        setChannels([...channels, name])
        setNewChannel("")
        setChannelError(null)
    }

    const removeChannel = (ch: string) => {
        if (ch === "general") return
        setChannels(channels.filter(c => c !== ch))
    }

    const deploy = async () => {
        setDeploying(true)
        setError(null)
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const adenaWallet = (window as any).adena
            if (!adenaWallet?.DoContract) throw new Error("Adena wallet not available")

            const config = defaultBoardConfig(daoRealmPath, daoName)
            config.channels = channels
            const code = generateBoardCode(config)
            const msg = buildDeployBoardMsg(callerAddress, config.boardRealmPath, code, "10000000ugnot")
            const gas = getGasConfig()

            const res = await adenaWallet.DoContract({
                messages: [{ type: "/vm.m_addpkg", value: msg.value }],
                gasFee: gas.fee,
                gasWanted: gas.deployWanted,
                memo: `Deploy Board for ${daoName}`,
            })

            if (res.status === "failure") {
                throw new Error(res.message || "Board deployment failed")
            }

            onDeployed()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Deployment failed")
        } finally {
            setDeploying(false)
        }
    }

    return (
        <div
            style={{
                position: "fixed", inset: 0, zIndex: 100,
                background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
                display: "flex", alignItems: "center", justifyContent: "center",
            }}
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="k-card" style={{
                width: 420, maxWidth: "90vw", padding: 28,
                background: "#111", border: "1px solid rgba(0,212,170,0.15)",
                display: "flex", flexDirection: "column", gap: 20,
            }}>
                <div>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f0f0f0", marginBottom: 4 }}>
                        💬 Deploy Discussion Board
                    </h3>
                    <p style={{ fontSize: 11, color: "#666", fontFamily: "JetBrains Mono, monospace" }}>
                        Deploy a companion board realm for <strong style={{ color: "#00d4aa" }}>{daoName}</strong>
                    </p>
                </div>

                {/* Channel config */}
                <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#f0f0f0", display: "block", marginBottom: 6 }}>
                        Initial Channels
                    </label>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                        {channels.map(ch => (
                            <span key={ch} style={{
                                fontSize: 11, padding: "4px 10px", borderRadius: 6,
                                background: "rgba(0,212,170,0.08)", border: "1px solid rgba(0,212,170,0.2)",
                                color: "#00d4aa", fontFamily: "JetBrains Mono, monospace",
                                display: "flex", alignItems: "center", gap: 6,
                            }}>
                                #{ch}
                                {ch !== "general" && (
                                    <button onClick={() => removeChannel(ch)} style={{
                                        background: "none", border: "none", cursor: "pointer",
                                        color: "#888", fontSize: 12, padding: 0,
                                    }}>×</button>
                                )}
                            </span>
                        ))}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <input
                            value={newChannel}
                            onChange={e => { setNewChannel(e.target.value); setChannelError(null) }}
                            onKeyDown={e => e.key === "Enter" && addChannel()}
                            placeholder="channel-name"
                            style={{ ...inputStyle, flex: 1 }}
                            maxLength={30}
                        />
                        <button className="k-btn-secondary" onClick={addChannel} style={{ fontSize: 11, padding: "8px 14px" }}>
                            + Add
                        </button>
                    </div>
                    {channelError && (
                        <div style={{ fontSize: 10, color: "#ff3b30", marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                            {channelError}
                        </div>
                    )}
                </div>

                {/* Error */}
                {error && (
                    <div style={{
                        fontSize: 11, color: "#ff4757", fontFamily: "JetBrains Mono, monospace",
                        background: "rgba(255,71,87,0.08)", padding: "8px 12px", borderRadius: 6,
                    }}>
                        {error}
                    </div>
                )}

                {/* Actions */}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button className="k-btn-secondary" onClick={onClose} style={{ fontSize: 12, padding: "8px 16px" }}>
                        Cancel
                    </button>
                    <button
                        className="k-btn-primary"
                        onClick={deploy}
                        disabled={deploying}
                        style={{ fontSize: 12, padding: "8px 20px", opacity: deploying ? 0.6 : 1 }}
                    >
                        {deploying ? "Deploying..." : "🚀 Deploy Board"}
                    </button>
                </div>
            </div>
        </div>
    )
}
