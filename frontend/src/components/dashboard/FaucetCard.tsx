/**
 * FaucetCard — Onboarding card for gasless first interaction.
 *
 * Shows on the Dashboard when:
 * 1. Wallet is connected
 * 2. User hasn't dismissed the card
 * 3. Active network has a faucet URL configured
 *
 * Directs to the external faucet for the active chain.
 * Records the claim in per-address localStorage after click.
 * User can dismiss the card permanently (localStorage).
 */

import { useState, useMemo } from "react"
import { Drop, X } from "@phosphor-icons/react"
import {
    canClaimFaucet,
    recordFaucetClaim,
    isFaucetDismissed,
    dismissFaucet,
    type FaucetEligibility,
} from "../../lib/faucet"
import { GNO_FAUCET_URL } from "../../lib/config"
import "./faucet-card.css"

interface FaucetCardProps {
    address: string | null
}

export function FaucetCard({ address }: FaucetCardProps) {
    const [claimed, setClaimed] = useState(false)
    const [dismissed, setDismissed] = useState(() => isFaucetDismissed())
    // C1 fix: counter increments after claim → forces useMemo to recalculate
    const [claimVersion, setClaimVersion] = useState(0)

    const eligibility: FaucetEligibility = useMemo(
        () => canClaimFaucet(address),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [address, claimVersion],
    )

    // I1 fix: hide card entirely when no faucet URL for active network
    if (!address || !GNO_FAUCET_URL || dismissed) return null

    // Hide if already claimed this session (optimistic)
    if (claimed) {
        return (
            <div className="faucet-card" data-testid="faucet-card-claimed">
                <div className="faucet-card-icon">
                    <Drop size={24} weight="fill" color="#00d4aa" />
                </div>
                <div className="faucet-card-content">
                    <div className="faucet-card-claimed">
                        ✓ Faucet opened — tokens will arrive shortly
                    </div>
                </div>
            </div>
        )
    }

    const handleClaim = () => {
        if (!address || !eligibility.eligible) return
        recordFaucetClaim(address)
        setClaimed(true)
        setClaimVersion(v => v + 1) // C1 fix: invalidate memo
        // Open external faucet in new tab
        window.open(GNO_FAUCET_URL, "_blank", "noopener,noreferrer")
    }

    const handleDismiss = () => {
        dismissFaucet()
        setDismissed(true)
    }

    // I2 fix: when on cooldown, show static desc + timer separately (no duplication)
    const descText = eligibility.eligible
        ? "Claim free test tokens from the gno.land testnet faucet (5, 10, or 15 GNOT options available)."
        : "You've already claimed tokens recently. Come back when the cooldown expires."

    return (
        <div className="faucet-card" data-testid="faucet-card">
            <div className="faucet-card-icon">
                <Drop size={24} weight="duotone" color="#00d4aa" />
            </div>
            <div className="faucet-card-content">
                <div className="faucet-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    Get Free Test Tokens
                    <span style={{
                        fontSize: 9, padding: "2px 6px", borderRadius: 4,
                        background: "rgba(245,166,35,0.1)", color: "#f5a623",
                        fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                        letterSpacing: "0.05em",
                    }}>
                        TESTNET ONLY
                    </span>
                </div>
                <div className="faucet-card-desc">{descText}</div>
                {!eligibility.eligible && eligibility.cooldownRemaining && (
                    <div className="faucet-card-cooldown" data-testid="faucet-cooldown">
                        ⏳ {eligibility.reason}
                    </div>
                )}
            </div>
            <div className="faucet-card-actions" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                    className="faucet-claim-btn"
                    onClick={handleClaim}
                    disabled={!eligibility.eligible}
                    data-testid="faucet-claim-btn"
                >
                    {eligibility.eligible ? "Open Faucet →" : "On Cooldown"}
                </button>
                <button
                    onClick={handleDismiss}
                    title="Dismiss this card"
                    aria-label="Dismiss faucet card"
                    style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: "#555", padding: 4, display: "flex",
                        transition: "color 0.15s",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#f0f0f0")}
                    onMouseLeave={e => (e.currentTarget.style.color = "#555")}
                >
                    <X size={16} />
                </button>
            </div>
        </div>
    )
}
