/**
 * WizardStepExtensions — Step 4 of CreateDAO wizard.
 *
 * Lets users toggle optional plugins (Board, GnoSwap, Leaderboard)
 * and configure their settings before deployment.
 */

import { useState } from "react"
import { FormField, inputStyle, type Step } from "./wizardShared"
import { isValidChannel } from "../../lib/boardTemplate"

interface Props {
    enableBoard: boolean
    boardChannels: string[]
    onEnableBoardChange: (v: boolean) => void
    onBoardChannelsChange: (v: string[]) => void
    onGoToStep: (s: Step) => void
    onNext: () => void
}

export function WizardStepExtensions({
    enableBoard, boardChannels,
    onEnableBoardChange, onBoardChannelsChange,
    onGoToStep, onNext,
}: Props) {
    const [newChannel, setNewChannel] = useState("")
    const [channelError, setChannelError] = useState<string | null>(null)

    const addChannel = () => {
        const name = newChannel.trim().toLowerCase()
        if (!name) return
        if (!isValidChannel(name)) {
            setChannelError("Must start with a letter, only a-z, 0-9, _, -")
            return
        }
        if (boardChannels.includes(name)) {
            setChannelError("Channel already exists")
            return
        }
        if (boardChannels.length >= 5) {
            setChannelError("Maximum 5 initial channels")
            return
        }
        onBoardChannelsChange([...boardChannels, name])
        setNewChannel("")
        setChannelError(null)
    }

    const removeChannel = (ch: string) => {
        if (ch === "general") return // can't remove default
        onBoardChannelsChange(boardChannels.filter(c => c !== ch))
    }

    return (
        <div className="k-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
            <div>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text)", marginBottom: 4 }}>
                    🧩 Extensions
                </h3>
                <p style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace" }}>
                    Enable optional plugins for your DAO. These deploy companion realms alongside your DAO.
                </p>
            </div>

            {/* Board Extension */}
            <div
                className="k-card"
                style={{
                    padding: 20,
                    border: enableBoard ? "1px solid rgba(0,212,170,0.3)" : "1px solid rgba(255,255,255,0.06)",
                    background: enableBoard ? "rgba(0,212,170,0.03)" : "rgba(255,255,255,0.02)",
                    transition: "all 0.2s",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: enableBoard ? 16 : 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 22 }}>💬</span>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>Discussion Board</div>
                            <div style={{ fontSize: 10, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace" }}>
                                Channels, threads, and replies for DAO members
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => onEnableBoardChange(!enableBoard)}
                        style={{
                            width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer",
                            background: enableBoard ? "#00d4aa" : "rgba(255,255,255,0.1)",
                            position: "relative", transition: "background 0.2s",
                        }}
                    >
                        <div style={{
                            width: 18, height: 18, borderRadius: "50%", background: "#fff",
                            position: "absolute", top: 3,
                            left: enableBoard ? 23 : 3, transition: "left 0.2s",
                        }} />
                    </button>
                </div>

                {/* Channel config (shown when board enabled) */}
                {enableBoard && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <FormField label="Initial Channels" hint="Auto-created channels. #general is always included.">
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                                {boardChannels.map(ch => (
                                    <span
                                        key={ch}
                                        style={{
                                            fontSize: 11, padding: "4px 10px", borderRadius: 6,
                                            background: "rgba(0,212,170,0.08)", border: "1px solid rgba(0,212,170,0.2)",
                                            color: "var(--color-primary)", fontFamily: "JetBrains Mono, monospace",
                                            display: "flex", alignItems: "center", gap: 6,
                                        }}
                                    >
                                        #{ch}
                                        {ch !== "general" && (
                                            <button
                                                onClick={() => removeChannel(ch)}
                                                style={{
                                                    background: "none", border: "none", cursor: "pointer",
                                                    color: "var(--color-text-secondary)", fontSize: 12, padding: 0, lineHeight: 1,
                                                }}
                                            >×</button>
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
                                <button
                                    className="k-btn-secondary"
                                    onClick={addChannel}
                                    style={{ fontSize: 11, padding: "8px 14px", whiteSpace: "nowrap" }}
                                >
                                    + Add
                                </button>
                            </div>
                            {channelError && (
                                <div style={{ fontSize: 10, color: "var(--color-danger)", marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                                    {channelError}
                                </div>
                            )}
                        </FormField>
                    </div>
                )}
            </div>

            {/* GnoSwap — informational */}
            <div className="k-card" style={{ padding: 20, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 22 }}>🔄</span>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>GnoSwap</div>
                            <div style={{ fontSize: 10, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace" }}>
                                DEX integration — available when pools exist on-chain
                            </div>
                        </div>
                    </div>
                    <span style={{
                        fontSize: 9, padding: "3px 8px", borderRadius: 4,
                        background: "rgba(123,97,255,0.08)", border: "1px solid rgba(123,97,255,0.2)",
                        color: "#7b61ff", fontFamily: "JetBrains Mono, monospace",
                    }}>
                        AUTO-DETECT
                    </span>
                </div>
            </div>

            {/* Leaderboard — informational */}
            <div className="k-card" style={{ padding: 20, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 22 }}>🏆</span>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>Leaderboard</div>
                            <div style={{ fontSize: 10, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace" }}>
                                Contribution ranking — powered by Gnolove analytics
                            </div>
                        </div>
                    </div>
                    <span style={{
                        fontSize: 9, padding: "3px 8px", borderRadius: 4,
                        background: "rgba(123,97,255,0.08)", border: "1px solid rgba(123,97,255,0.2)",
                        color: "#7b61ff", fontFamily: "JetBrains Mono, monospace",
                    }}>
                        AUTO-DETECT
                    </span>
                </div>
            </div>

            {/* Navigation */}
            <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button className="k-btn-secondary" onClick={() => onGoToStep(3)} style={{ fontSize: 13, padding: "10px 20px" }}>
                    ← Back
                </button>
                <button className="k-btn-primary" onClick={onNext} style={{ fontSize: 13, padding: "10px 24px" }}>
                    Next: Review →
                </button>
            </div>
        </div>
    )
}
