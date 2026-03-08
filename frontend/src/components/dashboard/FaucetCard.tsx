/**
 * FaucetCard — Onboarding card for gasless first interaction.
 *
 * Shows on the Dashboard when:
 * 1. Wallet is connected
 * 2. User is eligible to claim (no claim in last 7 days)
 *
 * Directs to the external faucet (test11: faucet.gno.land).
 * Records the claim in per-address localStorage after click.
 */

import { useState, useMemo } from "react"
import { Drop } from "@phosphor-icons/react"
import {
    canClaimFaucet,
    recordFaucetClaim,
    FAUCET_AMOUNT_DISPLAY,
    type FaucetEligibility,
} from "../../lib/faucet"
import "./faucet-card.css"

/** External faucet URL for test11. */
const FAUCET_URL = "https://faucet.gno.land"

interface FaucetCardProps {
    address: string | null
}

export function FaucetCard({ address }: FaucetCardProps) {
    const [claimed, setClaimed] = useState(false)

    const eligibility: FaucetEligibility = useMemo(
        () => canClaimFaucet(address),
        [address],
    )

    // Hide card entirely when not connected
    if (!address) return null

    // Hide if already claimed this session (optimistic)
    if (claimed) {
        return (
            <div className="faucet-card" data-testid="faucet-card-claimed">
                <div className="faucet-card-icon">
                    <Drop size={24} weight="fill" color="#00d4aa" />
                </div>
                <div className="faucet-card-content">
                    <div className="faucet-card-claimed">
                        ✓ Faucet claim recorded — tokens will arrive shortly
                    </div>
                </div>
            </div>
        )
    }

    const handleClaim = () => {
        if (!address || !eligibility.eligible) return
        recordFaucetClaim(address)
        setClaimed(true)
        // Open external faucet in new tab
        window.open(FAUCET_URL, "_blank", "noopener,noreferrer")
    }

    return (
        <div className="faucet-card" data-testid="faucet-card">
            <div className="faucet-card-icon">
                <Drop size={24} weight="duotone" color="#00d4aa" />
            </div>
            <div className="faucet-card-content">
                <div className="faucet-card-title">
                    Get started with {FAUCET_AMOUNT_DISPLAY}
                </div>
                <div className="faucet-card-desc">
                    {eligibility.eligible
                        ? "Claim free test tokens to start interacting with the gno.land ecosystem — deploy DAOs, create tokens, and vote."
                        : eligibility.reason}
                </div>
                {!eligibility.eligible && eligibility.cooldownRemaining && (
                    <div className="faucet-card-cooldown" data-testid="faucet-cooldown">
                        ⏳ {eligibility.reason}
                    </div>
                )}
            </div>
            <div className="faucet-card-actions">
                <button
                    className="faucet-claim-btn"
                    onClick={handleClaim}
                    disabled={!eligibility.eligible}
                    data-testid="faucet-claim-btn"
                >
                    {eligibility.eligible ? `Claim ${FAUCET_AMOUNT_DISPLAY}` : "On Cooldown"}
                </button>
            </div>
        </div>
    )
}
