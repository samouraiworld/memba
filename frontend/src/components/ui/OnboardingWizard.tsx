/**
 * OnboardingWizard — 3-step guided introduction for first-time users.
 *
 * Shows after first wallet connection. Steps:
 * 1. Welcome — explain what Memba does
 * 2. Explore — highlight key features (DAOs, Quests, Validators)
 * 3. Get Started — direct to first quest or DAO list
 *
 * Per-wallet localStorage flag prevents repeat showing.
 *
 * @module components/ui/OnboardingWizard
 */

import { useState, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { useNetworkKey } from "../../hooks/useNetworkNav"
import { markWizardSeen } from "../../lib/onboarding"
import "./onboarding-wizard.css"

interface OnboardingWizardProps {
    address: string
    onClose: () => void
}

const STEPS = [
    {
        title: "Welcome to Memba",
        body: "Your hub for Gno governance, multisig wallets, and on-chain collaboration. Manage DAOs, vote on proposals, track validators, and earn XP through quests.",
        cta: "Next",
    },
    {
        title: "What you can do",
        body: null, // rendered as feature grid
        cta: "Next",
    },
    {
        title: "Ready to explore",
        body: "Start by browsing DAOs, or jump into quests to earn XP and climb the leaderboard. Your progress is saved to your wallet.",
        cta: null, // rendered as action buttons
    },
]

const FEATURES = [
    { icon: "🏛️", label: "DAO Governance", desc: "Vote, propose, and manage treasuries" },
    { icon: "🔑", label: "Multisig Wallets", desc: "Shared wallets with threshold signing" },
    { icon: "🎮", label: "GnoBuilders Quests", desc: "85 quests, earn XP, climb ranks" },
    { icon: "🤖", label: "AI Analyst", desc: "10-model consensus on proposals" },
    { icon: "📊", label: "Validators", desc: "Monitor network health and performance" },
    { icon: "❤️", label: "Gnolove", desc: "Open source contributor analytics" },
]

export function OnboardingWizard({ address, onClose }: OnboardingWizardProps) {
    const [step, setStep] = useState(0)
    const navigate = useNavigate()
    const nk = useNetworkKey()

    const handleClose = useCallback(() => {
        markWizardSeen(address)
        onClose()
    }, [address, onClose])

    const handleNext = useCallback(() => {
        if (step < STEPS.length - 1) {
            setStep(s => s + 1)
        }
    }, [step])

    const handleGoTo = useCallback((path: string) => {
        handleClose()
        navigate(`/${nk}${path}`)
    }, [handleClose, navigate, nk])

    const current = STEPS[step]

    return (
        <div className="k-onboarding-overlay" role="dialog" aria-modal="true" aria-label="Welcome wizard">
            <div className="k-onboarding-card">
                {/* Progress dots */}
                <div className="k-onboarding-progress">
                    {STEPS.map((_, i) => (
                        <span key={i} className={`k-onboarding-dot${i === step ? " active" : i < step ? " done" : ""}`} />
                    ))}
                </div>

                {/* Skip button */}
                <button className="k-onboarding-skip" onClick={handleClose} aria-label="Skip onboarding">
                    Skip
                </button>

                {/* Step content */}
                <h2 className="k-onboarding-title">{current.title}</h2>

                {step === 1 ? (
                    <div className="k-onboarding-features">
                        {FEATURES.map(f => (
                            <div key={f.label} className="k-onboarding-feature">
                                <span className="k-onboarding-feature-icon">{f.icon}</span>
                                <div>
                                    <div className="k-onboarding-feature-label">{f.label}</div>
                                    <div className="k-onboarding-feature-desc">{f.desc}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="k-onboarding-body">{current.body}</p>
                )}

                {/* Actions */}
                <div className="k-onboarding-actions">
                    {step < STEPS.length - 1 ? (
                        <button className="k-onboarding-btn-primary" onClick={handleNext}>
                            {current.cta}
                        </button>
                    ) : (
                        <>
                            <button className="k-onboarding-btn-primary" onClick={() => handleGoTo("/quests")}>
                                Start Quests
                            </button>
                            <button className="k-onboarding-btn-secondary" onClick={() => handleGoTo("/dao")}>
                                Browse DAOs
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
