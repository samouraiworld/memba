/**
 * QuestDetail — Full quest detail page with verification flow.
 *
 * Shows quest description, requirements, difficulty, prerequisite chain,
 * verification status, and badge preview.
 *
 * Route: /:network/quests/:questId
 */

import { useState, useEffect, useMemo, useCallback } from "react"
import { useParams, Link } from "react-router-dom"
import { useAdena } from "../hooks/useAdena"
import { useNetworkKey } from "../hooks/useNetworkNav"
import { loadQuestProgress, completeQuest } from "../lib/quests"
import {
    getQuestById,
    isQuestAvailable,
    type GnoQuest,
} from "../lib/gnobuilders"
import { verifyQuest, verifyDeployment, type QuestVerificationResult } from "../lib/questVerifier"
import { GNO_RPC_URL } from "../lib/config"
import { trackPageVisit } from "../lib/quests"
import { useAuth } from "../hooks/useAuth"
import "./questhub.css"

const DIFFICULTY_COLORS: Record<string, string> = {
    beginner: "#22c55e",
    intermediate: "#3b82f6",
    advanced: "#f59e0b",
    expert: "#ef4444",
}

export default function QuestDetail() {
    const { questId } = useParams<{ questId: string }>()
    const { address } = useAdena()
    const auth = useAuth()
    const nk = useNetworkKey()

    const quest = questId ? getQuestById(questId) : undefined
    const state = useMemo(() => loadQuestProgress(), [])
    const completedIds = useMemo(() => new Set(state.completed.map(c => c.questId)), [state])

    const [verification, setVerification] = useState<QuestVerificationResult | null>(null)
    const [verifying, setVerifying] = useState(false)
    const [realmPath, setRealmPath] = useState("")

    useEffect(() => {
        document.title = quest ? `${quest.title} — GnoBuilders` : "Quest Not Found"
        trackPageVisit("quest-detail")
    }, [quest])

    const isCompleted = questId ? completedIds.has(questId) : false
    const isAvailable = questId ? isQuestAvailable(questId, completedIds) : false

    // Get prerequisite chain
    const prereqChain = useMemo(() => {
        if (!quest) return []
        const chain: GnoQuest[] = []
        let current = quest
        while (current.prerequisite) {
            const prereq = getQuestById(current.prerequisite)
            if (!prereq) break
            chain.unshift(prereq)
            current = prereq
        }
        return chain
    }, [quest])

    const handleVerify = useCallback(async () => {
        if (!questId || !address) return
        setVerifying(true)
        try {
            const result = await verifyQuest(questId, address, GNO_RPC_URL, auth.token ?? undefined)
            setVerification(result)

            if (result.status === "verified" && !isCompleted) {
                completeQuest(questId, auth.token ?? undefined)
            }
        } catch {
            setVerification({ status: "error", message: "Verification failed" })
        } finally {
            setVerifying(false)
        }
    }, [questId, address, auth.token, isCompleted])

    const handleDeploymentVerify = useCallback(async () => {
        if (!realmPath.trim() || !address) return
        setVerifying(true)
        try {
            const result = await verifyDeployment(GNO_RPC_URL, realmPath.trim(), address)
            setVerification(result)

            if (result.status === "verified" && questId && !isCompleted) {
                completeQuest(questId, auth.token ?? undefined)
            }
        } catch {
            setVerification({ status: "error", message: "Verification failed" })
        } finally {
            setVerifying(false)
        }
    }, [realmPath, address, questId, auth.token, isCompleted])

    if (!quest) {
        return (
            <div className="k-questhub">
                <h1>Quest Not Found</h1>
                <p>No quest with ID: {questId}</p>
                <Link to={`/${nk}/quests`}>Back to Quest Hub</Link>
            </div>
        )
    }

    const diffColor = DIFFICULTY_COLORS[quest.difficulty] || "#6b7280"
    const isDeployQuest = quest.id.startsWith("deploy-")

    return (
        <div className="k-questhub">
            {/* Breadcrumb */}
            <div className="k-questdetail-breadcrumb">
                <Link to={`/${nk}/quests`}>Quests</Link>
                <span> / </span>
                <span>{quest.title}</span>
            </div>

            {/* Header */}
            <div className="k-questdetail-header">
                <span className="k-questdetail-icon">{quest.icon}</span>
                <div>
                    <h1>{quest.title}</h1>
                    <p className="k-questdetail-desc">{quest.description}</p>
                </div>
                <span className="k-quest-card-xp" style={{ fontSize: "1rem" }}>+{quest.xp} XP</span>
            </div>

            {/* Meta */}
            <div className="k-questdetail-meta">
                <span className="k-quest-card-difficulty" style={{ color: diffColor, borderColor: diffColor }}>
                    {quest.difficulty}
                </span>
                <span className="k-quest-card-category">{quest.category}</span>
                <span className="k-quest-card-tag">{quest.verification.replace("_", " ")}</span>
                {quest.season > 1 && <span className="k-quest-card-tag">Season {quest.season}</span>}
            </div>

            {/* Status */}
            <div className="k-questdetail-status">
                {isCompleted ? (
                    <div className="k-questdetail-completed">
                        <span>Completed</span>
                    </div>
                ) : isAvailable ? (
                    <div className="k-questdetail-available">
                        <span>Available</span>
                    </div>
                ) : (
                    <div className="k-questdetail-locked">
                        <span>Locked — complete prerequisite first</span>
                    </div>
                )}
            </div>

            {/* Prerequisite chain */}
            {prereqChain.length > 0 && (
                <div className="k-questdetail-prereqs">
                    <h3>Prerequisite Chain</h3>
                    <div className="k-questdetail-chain">
                        {prereqChain.map(p => (
                            <Link key={p.id} to={`/${nk}/quests/${p.id}`} className="k-questdetail-chain-item">
                                <span>{p.icon}</span>
                                <span>{p.title}</span>
                                {completedIds.has(p.id) ? <span className="k-quest-card-status--done">done</span> : <span className="k-quest-card-status--locked">needed</span>}
                            </Link>
                        ))}
                        <div className="k-questdetail-chain-item k-questdetail-chain-item--current">
                            <span>{quest.icon}</span>
                            <span>{quest.title}</span>
                            <span>(this quest)</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Verification section */}
            {!isCompleted && isAvailable && (
                <div className="k-questdetail-verify">
                    <h3>Verification</h3>

                    {isDeployQuest && quest.verification === "on_chain" && (
                        <div className="k-questdetail-deploy-form">
                            <label>Enter your deployed realm/package path:</label>
                            <div style={{ display: "flex", gap: 8 }}>
                                <input
                                    type="text"
                                    className="k-questhub-search"
                                    placeholder="gno.land/r/yourname/realm"
                                    value={realmPath}
                                    onChange={e => setRealmPath(e.target.value)}
                                />
                                <button
                                    className="k-questdetail-verify-btn"
                                    onClick={handleDeploymentVerify}
                                    disabled={verifying || !realmPath.trim()}
                                >
                                    {verifying ? "Checking..." : "Verify"}
                                </button>
                            </div>
                        </div>
                    )}

                    {!isDeployQuest && (
                        <button
                            className="k-questdetail-verify-btn"
                            onClick={handleVerify}
                            disabled={verifying || !address}
                        >
                            {verifying ? "Verifying..." : "Check Completion"}
                        </button>
                    )}

                    {!address && (
                        <p className="k-questdetail-hint">Connect your wallet to verify this quest.</p>
                    )}

                    {verification && (
                        <div className={`k-questdetail-result k-questdetail-result--${verification.status}`}>
                            <span>{verification.status === "verified" ? "Verified!" : verification.status === "pending" ? "Pending..." : verification.message}</span>
                        </div>
                    )}
                </div>
            )}

            {/* Back link */}
            <div style={{ marginTop: 24 }}>
                <Link to={`/${nk}/quests`} className="k-questhub-leaderboard-link">
                    Back to Quest Hub
                </Link>
            </div>
        </div>
    )
}
