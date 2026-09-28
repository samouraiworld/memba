/**
 * QuestDetail — Full quest detail page with verification flow.
 *
 * Shows quest description, requirements, difficulty, prerequisite chain,
 * verification status, and badge preview.
 *
 * Route: /:network/quests/:questId
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { useParams, Link, useLocation } from "react-router-dom"
import { useAdena } from "../hooks/useAdena"
import { useNetworkKey } from "../hooks/useNetworkNav"
import { loadQuestProgress, completeQuest, completeQuestVerified } from "../lib/quests"
import {
    getQuestById,
    isQuestAvailable,
    isQuestLive,
    isBackendVerifiedQuest,
    type GnoQuest,
} from "../lib/gnobuilders"
import { verifyQuest, type QuestVerificationResult } from "../lib/questVerifier"
import { isQuestAvailableOnNetwork, notOnNetworkMessage, QUEST_NOT_ON_NETWORK_LABEL } from "../lib/questNetwork"
import { SelfReportForm } from "../components/quests/SelfReportForm"
import { GNO_RPC_URL } from "../lib/config"
import { trackPageVisit } from "../lib/quests"
import { useAuth } from "../hooks/useAuth"
import "./questhub.css"

const DIFFICULTY_COLORS: Record<string, string> = {
    beginner: "var(--color-k-success-text)",
    intermediate: "var(--color-k-info-text)",
    advanced: "var(--color-k-warning-text)",
    expert: "var(--color-k-danger-text)",
}

/** A profile link may carry the Hub's filter query for an explicit return. */
function hubReturnQuery(search: string): string {
    const from = new URLSearchParams(search).get("from")
    if (!from || from.length > 256) return ""
    const params = new URLSearchParams(from)
    const allowed = new Set(["category", "difficulty", "status", "q"])
    if ([...params.keys()].some(key => !allowed.has(key)) || [...params.values()].some(value => value.length > 100)) return ""
    return params.toString()
}

export default function QuestDetail() {
    const { questId } = useParams<{ questId: string }>()
    const { address } = useAdena()
    // A route or wallet change starts a new verification session. The previous
    // session's result, proof field, and self-report status cannot carry over.
    return <QuestDetailSession key={`${questId ?? ""}:${address ?? ""}`} questId={questId} address={address} />
}

function QuestDetailSession({ questId, address }: { questId: string | undefined; address: string | null | undefined }) {
    const auth = useAuth()
    const nk = useNetworkKey()
    const location = useLocation()
    const from = hubReturnQuery(location.search)
    const hubPath = `/${nk}/quests${from ? `?${from}` : ""}`
    const active = useRef(true)
    const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const quest = questId ? getQuestById(questId) : undefined
    const [state, setState] = useState(() => loadQuestProgress(address || null))
    const completedIds = useMemo(() => new Set(state.completed.map(c => c.questId)), [state])

    const [verification, setVerification] = useState<QuestVerificationResult | null>(null)
    const [verifying, setVerifying] = useState(false)
    const [realmPath, setRealmPath] = useState("")
    const [showCelebration, setShowCelebration] = useState(false)

    useEffect(() => {
        active.current = true
        return () => {
            active.current = false
            if (celebrationTimer.current) clearTimeout(celebrationTimer.current)
        }
    }, [])

    const celebrate = useCallback(() => {
        setShowCelebration(true)
        if (celebrationTimer.current) clearTimeout(celebrationTimer.current)
        celebrationTimer.current = setTimeout(() => setShowCelebration(false), 4000)
    }, [])

    useEffect(() => {
        document.title = quest ? `${quest.title} — GnoBuilders` : "Quest Not Found"
        trackPageVisit("quest-detail")

        // Refresh local quest state when any quest completes, so the status pill
        // and verification section reflect the new state immediately (no longer
        // celebrating success while the page still says "Available").
        const onQuestComplete = () => setState(loadQuestProgress(address || null))
        window.addEventListener("quest-completed", onQuestComplete)
        return () => window.removeEventListener("quest-completed", onQuestComplete)
    }, [quest, address])

    const isCompleted = questId ? completedIds.has(questId) : false
    const isAvailable = questId ? isQuestAvailable(questId, completedIds) : false
    // Phase 0: only curated "live" quests expose a verification path. Non-live
    // quests show a "coming soon" note instead of a button that can't succeed.
    const isLive = questId ? isQuestLive(questId) : false
    // A quest whose realm isn't deployed on this network can't complete here —
    // no verify action, just an explanation.
    const onNetwork = questId ? isQuestAvailableOnNetwork(questId, nk) : true

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
        if (!auth.token || auth.token.userAddress !== address) {
            setVerification({ status: "not_verified", message: "Sign in with this wallet to verify." })
            return
        }
        setVerifying(true)
        try {
            const result = await verifyQuest(questId, address, GNO_RPC_URL, auth.token)
            if (!active.current) return
            setVerification(result)

            if (result.status === "verified" && !isCompleted) {
                completeQuest(questId, auth.token)
                setState(loadQuestProgress(address))
                celebrate()
            }
        } catch {
            if (active.current) setVerification({ status: "error", message: "Verification failed" })
        } finally {
            if (active.current) setVerifying(false)
        }
    }, [questId, address, auth.token, isCompleted, celebrate])

    const handleDeploymentVerify = useCallback(async () => {
        if (!realmPath.trim() || !address || !questId) return
        if (!auth.token || auth.token.userAddress !== address) {
            setVerification({ status: "not_verified", message: "Connect your wallet to verify." })
            return
        }
        setVerifying(true)
        setVerification(null)
        try {
            // Backend-gated: the server verifies the realm path is under your
            // registered @username namespace, exists on-chain, and isn't already
            // used for another deploy quest. It throws if any check fails.
            await completeQuestVerified(questId, realmPath.trim(), auth.token)
            if (!active.current) return
            setVerification({ status: "verified", message: "Verified!" })
            celebrate()
        } catch {
            if (active.current) setVerification({
                status: "error",
                message: "Verification didn't complete. Check that this path exists under your registered @username namespace, then try again.",
            })
        } finally {
            if (active.current) setVerifying(false)
        }
    }, [realmPath, address, questId, auth.token, celebrate])

    // Backend-verified on_chain quests (join-dao, create-token): the server
    // re-verifies on-chain from the user's address (no proof, no client pre-check
    // on the wrong chain). completeQuestVerified awaits the verdict and throws if
    // the requirement isn't met.
    const handleBackendVerify = useCallback(async () => {
        if (!questId || !address) return
        if (!auth.token || auth.token.userAddress !== address) {
            setVerification({ status: "not_verified", message: "Connect your wallet to verify." })
            return
        }
        setVerifying(true)
        setVerification(null)
        try {
            await completeQuestVerified(questId, "", auth.token)
            if (!active.current) return
            setVerification({ status: "verified", message: "Verified!" })
            celebrate()
        } catch (err) {
            if (active.current) setVerification({
                status: "not_verified",
                message: notOnNetworkMessage(err)
                    ?? (quest?.verification === "off_chain"
                        ? "Couldn't verify this action yet — complete the requirement, then try again."
                        : "Couldn't verify on-chain yet — complete the action, then try again."),
            })
        } finally {
            if (active.current) setVerifying(false)
        }
    }, [questId, address, auth.token, celebrate, quest?.verification])

    if (!quest) {
        return (
            <div className="k-questhub">
                <h1>Quest Not Found</h1>
                <p>No quest with ID: {questId}</p>
                <Link to={hubPath}>Back to Quest Hub</Link>
            </div>
        )
    }

    const diffColor = DIFFICULTY_COLORS[quest.difficulty] || "var(--color-text-disabled)"
    const isDeployQuest = quest.id === "deploy-hello-pkg" || quest.id === "deploy-hello-realm"
    const deployKind = quest.id === "deploy-hello-pkg" ? "package" : "realm"
    const isSelfReport = quest.verification === "self_report"
    const isBackendVerified = isBackendVerifiedQuest(quest.id)

    return (
        <div className="k-questhub">
            {/* Breadcrumb */}
            <div className="k-questdetail-breadcrumb">
                <Link to={hubPath}>Quests</Link>
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
                <span className="k-quest-card-xp k-questdetail-header-xp">+{quest.xp} XP</span>
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
                ) : !isLive ? (
                    <div className="k-questdetail-locked">
                        <span>Coming soon</span>
                    </div>
                ) : !onNetwork ? (
                    <div className="k-questdetail-locked">
                        <span>{QUEST_NOT_ON_NETWORK_LABEL}</span>
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

            {/* Coming-soon explanation — non-live quests have no verify path yet */}
            {!isCompleted && !isLive && (
                <div className="k-questdetail-verify">
                    <p className="k-questdetail-hint">
                        This quest isn&apos;t live yet — its verification or reward is still
                        being wired up. It&apos;ll open in a future season.
                    </p>
                </div>
            )}

            {/* Not-on-network explanation — the quest's realm isn't deployed here */}
            {!isCompleted && isLive && !onNetwork && (
                <div className="k-questdetail-verify">
                    <p className="k-questdetail-hint">
                        The realm this quest checks isn&apos;t deployed on this network yet, so it
                        can&apos;t be completed here. It&apos;ll open once the realm is deployed.
                    </p>
                </div>
            )}

            {/* Prerequisite chain */}
            {prereqChain.length > 0 && (
                <div className="k-questdetail-prereqs">
                    <h3>Prerequisite Chain</h3>
                    <div className="k-questdetail-chain">
                        {prereqChain.map(p => (
                            <Link key={p.id} to={`/${nk}/quests/${p.id}${location.search}`} className="k-questdetail-chain-item">
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

            {/* Verification section (live + available quests on this network only) */}
            {!isCompleted && isAvailable && isLive && onNetwork && (
                <div className="k-questdetail-verify">
                    <h3>Verification</h3>

                    {isSelfReport ? (
                        <SelfReportForm questId={quest.id} address={address ?? ""} authToken={auth.token ?? null} />
                    ) : isDeployQuest && quest.verification === "on_chain" ? (
                        <div className="k-questdetail-deploy-form">
                            <label htmlFor="quest-deploy-path">Enter your deployed {deployKind} path:</label>
                            <div className="k-questdetail-deploy-row">
                                <input
                                    type="text"
                                    id="quest-deploy-path"
                                    className="k-questhub-search"
                                    placeholder={`gno.land/${deployKind === "package" ? "p" : "r"}/yourname/${deployKind}`}
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
                            <small className="k-questdetail-hint">
                                Must be a {deployKind} you deployed under your registered
                                @username namespace (e.g. <code>gno.land/{deployKind === "package" ? "p" : "r"}/yourname/{deployKind}</code>),
                                live on-chain, and not already used for another deploy quest.
                            </small>
                        </div>
                    ) : isBackendVerified ? (
                        <button
                            className="k-questdetail-verify-btn"
                            onClick={handleBackendVerify}
                            disabled={verifying || !address}
                        >
                            {verifying ? "Verifying..." : quest.verification === "off_chain" ? "Verify with Memba" : "Verify on-chain"}
                        </button>
                    ) : (
                        <button
                            className="k-questdetail-verify-btn"
                            onClick={handleVerify}
                            disabled={verifying || !address}
                        >
                            {verifying ? "Verifying..." : "Check Completion"}
                        </button>
                    )}

                    {!address && !isSelfReport && (
                        <p className="k-questdetail-hint">Connect your wallet to verify this quest.</p>
                    )}

                    {verification && (
                        <div className={`k-questdetail-result k-questdetail-result--${verification.status}`} role={verification.status === "error" ? "alert" : "status"}>
                            <span>{verification.status === "verified" ? "Verified!" : verification.status === "pending" ? "Pending..." : verification.message}</span>
                        </div>
                    )}
                </div>
            )}

            {/* Back link */}
            <div className="k-questdetail-back">
                <Link to={hubPath} className="k-questhub-leaderboard-link">
                    Back to Quest Hub
                </Link>
            </div>

            {/* Quest completion celebration */}
            {showCelebration && (
                <div className="k-quest-celebration" role="status" aria-live="polite">
                    <div className="k-quest-celebration__content">
                        <span className="k-quest-celebration__icon">+{quest.xp} XP</span>
                        <h3>Quest Complete!</h3>
                        <p>{quest.title}</p>
                    </div>
                </div>
            )}
        </div>
    )
}
