/**
 * DeploymentPipeline — Animated multi-step deployment progress modal overlay.
 *
 * Reusable across all Create flows (DAO, Multisig, Token).
 * Shows: Preparing → Signing → Broadcasting → Complete/Error
 *
 * v2.9: Converted from inline card to full-screen modal overlay with
 * dark backdrop, centered card, ESC-to-close, and body scroll lock.
 */

import { useEffect, useCallback } from "react"
import "./DeploymentPipeline.css"
import { getExplorerBaseUrl } from "../../lib/config"
import { useScrollToTop } from "../../hooks/useScrollToTop"

// ── Types ───────────────────────────────────────────────────

export type DeployStep = "idle" | "preparing" | "signing" | "broadcasting" | "complete" | "error"

export interface DeploymentResult {
    /** TX hash from broadcast. */
    txHash?: string
    /** Full realm path (e.g. gno.land/r/user/mydao) — for display. */
    realmPath?: string
    /** Navigable app path (e.g. /dao/slug or /multisig/g1...) */
    entityPath?: string
    /** Entity type label (e.g. "DAO", "Multisig", "Token") */
    entityLabel?: string
    /** User-facing entity name. */
    entityName?: string
}

export interface DeploymentPipelineProps {
    /** Show the pipeline. */
    active: boolean
    /** Current step in the deploy flow. */
    currentStep: DeployStep
    /** Deployment result (populated on success). */
    result?: DeploymentResult
    /** Error message (when currentStep === "error"). */
    error?: string
    /** Primary CTA on success — navigate to entity. */
    onNavigate: () => void
    /** Retry on failure. */
    onRetry?: () => void
    /** Dismiss/close. */
    onClose?: () => void
}

// ── Step definitions ────────────────────────────────────────

const STEPS: { key: DeployStep; icon: string; label: string; hint: string }[] = [
    { key: "preparing", icon: "📦", label: "Preparing", hint: "Building transaction..." },
    { key: "signing", icon: "✍️", label: "Signing", hint: "Waiting for wallet approval..." },
    { key: "broadcasting", icon: "📡", label: "Broadcasting", hint: "Sending to the network..." },
    { key: "complete", icon: "✅", label: "Confirmed", hint: "Transaction confirmed on-chain" },
]

const STEP_ORDER: DeployStep[] = ["preparing", "signing", "broadcasting", "complete"]

function getStepState(step: DeployStep, current: DeployStep): "waiting" | "active" | "done" | "error" {
    if (current === "error") {
        // Find the active step at time of error — mark it as error, prior as done
        const currentIdx = STEP_ORDER.indexOf(step)
        // Last non-error step was the one that failed
        return currentIdx < STEP_ORDER.length ? "error" : "waiting"
    }
    const stepIdx = STEP_ORDER.indexOf(step)
    const currentIdx = STEP_ORDER.indexOf(current)
    if (stepIdx < currentIdx) return "done"
    if (stepIdx === currentIdx) return "active"
    return "waiting"
}

// ── Component ───────────────────────────────────────────────

export function DeploymentPipeline({
    active,
    currentStep,
    result,
    error,
    onNavigate,
    onRetry,
    onClose,
}: DeploymentPipelineProps) {
    const isComplete = currentStep === "complete"
    const isError = currentStep === "error"
    const canDismiss = isComplete || isError

    // v2.10: Scroll to top when deployment modal activates
    useScrollToTop(active && currentStep !== "idle")

    // v2.9: Body scroll lock when modal is active
    useEffect(() => {
        if (!active || currentStep === "idle") return
        document.body.style.overflow = "hidden"
        return () => { document.body.style.overflow = "" }
    }, [active, currentStep])

    // v2.9: ESC to close (only when dismissible)
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "Escape" && canDismiss && onClose) onClose()
    }, [canDismiss, onClose])

    useEffect(() => {
        if (!active || currentStep === "idle") return
        document.addEventListener("keydown", handleKeyDown)
        return () => document.removeEventListener("keydown", handleKeyDown)
    }, [active, currentStep, handleKeyDown])

    if (!active || currentStep === "idle") return null

    const explorerBase = getExplorerBaseUrl()

    return (
        <div
            className="deploy-overlay"
            onClick={(e) => {
                // v2.9: Click outside to dismiss (only when complete/error)
                if (canDismiss && onClose && e.target === e.currentTarget) onClose()
            }}
            data-testid="deploy-overlay"
        >
            <div
                id="deployment-pipeline"
                className="deploy-modal k-card"
                style={{
                    borderColor: isComplete ? "rgba(0,212,170,0.2)" : isError ? "rgba(255,59,48,0.15)" : "#1a1a1a",
                }}
            >
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600, color: "#f0f0f0", margin: 0 }}>
                        {isComplete ? "🎉 Deployment Complete" : isError ? "⚠️ Deployment Failed" : "🚀 Deploying..."}
                    </h3>
                    {canDismiss && onClose && (
                        <button
                            id="deploy-pipeline-close"
                            onClick={onClose}
                            style={{
                                background: "none", border: "none", color: "#555",
                                cursor: "pointer", fontSize: 16, padding: "2px 6px",
                            }}
                            aria-label="Close"
                        >
                            ✕
                        </button>
                    )}
                </div>

                {/* Step Timeline */}
                <div className="deploy-pipeline-timeline">
                    {STEPS.map((step) => {
                        const state = isError
                            ? (STEP_ORDER.indexOf(step.key) < STEP_ORDER.indexOf(currentStep) ? "done" : step.key === currentStep ? "error" : "waiting")
                            : getStepState(step.key, currentStep)
                        const isDone = state === "done"
                        const isActive = state === "active"

                        return (
                            <div
                                key={step.key}
                                className="deploy-step"
                                data-done={isDone}
                                data-active={isActive}
                                data-testid={`deploy-step-${step.key}`}
                            >
                                <div className="deploy-step-icon" data-state={state}>
                                    {isDone ? "✓" : step.icon}
                                </div>
                                <div>
                                    <div className="deploy-step-label" data-state={state}>
                                        {step.label}
                                    </div>
                                    <div className="deploy-step-hint">
                                        {state === "error" ? (error || "An error occurred") : step.hint}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>

                {/* Completion Card */}
                {isComplete && result && (
                    <div className="deploy-complete-card" data-testid="deploy-complete">
                        <div className="deploy-complete-check">
                            <span style={{ fontSize: 28, color: "#00d4aa" }}>✓</span>
                        </div>
                        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#00d4aa", marginBottom: 6 }}>
                            {result.entityLabel || "Entity"} deployed successfully!
                        </h2>
                        {result.entityName && (
                            <p style={{ fontSize: 13, color: "#ccc", marginBottom: 12, fontFamily: "JetBrains Mono, monospace" }}>
                                {result.entityName}
                            </p>
                        )}
                        {result.realmPath && (
                            <p style={{ fontSize: 11, color: "#666", fontFamily: "JetBrains Mono, monospace", marginBottom: 8 }}>
                                {result.realmPath}
                            </p>
                        )}
                        {result.txHash && (
                            <p style={{ fontSize: 11, color: "#666", fontFamily: "JetBrains Mono, monospace", marginBottom: 16 }}>
                                TX:{" "}
                                <a
                                    href={`${explorerBase}/tx/${result.txHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: "#00d4aa", textDecoration: "none" }}
                                    id="deploy-tx-link"
                                >
                                    {result.txHash.slice(0, 16)}…
                                </a>
                            </p>
                        )}
                        {result.realmPath && (
                            <p style={{ marginBottom: 16 }}>
                                <a
                                    href={`${explorerBase}/r/${result.realmPath.replace("gno.land/r/", "")}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ fontSize: 11, color: "#00d4aa", textDecoration: "none", fontFamily: "JetBrains Mono, monospace" }}
                                    id="deploy-explorer-link"
                                >
                                    View on Explorer →
                                </a>
                            </p>
                        )}
                        <button
                            id="deploy-navigate-btn"
                            className="k-btn-primary"
                            onClick={onNavigate}
                            style={{ padding: "10px 24px", fontSize: 13 }}
                        >
                            Open {result.entityLabel || "Entity"} →
                        </button>
                    </div>
                )}

                {/* Error Card */}
                {isError && (
                    <div className="deploy-error-card" data-testid="deploy-error">
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#ff3b30", marginBottom: 6 }}>
                            {error || "Deployment failed"}
                        </div>
                        <p style={{ fontSize: 11, color: "#888", fontFamily: "JetBrains Mono, monospace", marginBottom: 14 }}>
                            The transaction could not be completed. You can retry from the beginning.
                        </p>
                        {onRetry && (
                            <button
                                id="deploy-retry-btn"
                                className="k-btn-secondary"
                                onClick={onRetry}
                                style={{ padding: "8px 18px", fontSize: 12 }}
                            >
                                ↻ Retry
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
