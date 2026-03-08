/**
 * FaucetCard — Onboarding card for gasless first interaction.
 *
 * Shows on the Dashboard when:
 * 1. Wallet is connected
 * 2. User is eligible to claim (no claim in last 7 days)
 * 3. Active network has a faucet URL configured
 *
 * Directs to the external faucet for the active chain.
 * Records the claim in per-address localStorage after click.
 *
 * Audit fixes applied:
 * - C1: claimVersion counter forces eligibility recalculation after claim
 * - I1: faucet URL sourced from config.ts (multi-chain)
 * - I2: cooldown reason shown only once (no desc duplication)
 */

import { useState, useMemo } from "react"
import { Drop } from "@phosphor-icons/react"
import {
    canClaimFaucet,
    recordFaucetClaim,
    FAUCET_AMOUNT_DISPLAY,
    type FaucetEligibility,
} from "../../lib/faucet"
import { GNO_FAUCET_URL } from "../../lib/config"
import "./faucet-card.css"

interface FaucetCardProps {
    address: string | null
}

export function FaucetCard({ address }: FaucetCardProps) {
    const [claimed, setClaimed] = useState(false)
    // C1 fix: counter increments after claim → forces useMemo to recalculate
    const [claimVersion, setClaimVersion] = useState(0)

    const eligibility: FaucetEligibility = useMemo(
        () => canClaimFaucet(address),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [address, claimVersion],
    )

    // I1 fix: hide card entirely when no faucet URL for active network
    if (!address || !GNO_FAUCET_URL) return null

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
        setClaimVersion(v => v + 1) // C1 fix: invalidate memo
        // Open external faucet in new tab
        window.open(GNO_FAUCET_URL, "_blank", "noopener,noreferrer")
    }

    // I2 fix: when on cooldown, show static desc + timer separately (no duplication)
    const descText = eligibility.eligible
        ? "Claim free test tokens to start interacting with the gno.land ecosystem — deploy DAOs, create tokens, and vote."
        : "You've already claimed tokens recently. Come back when the cooldown expires."

    return (
        <div className="faucet-card" data-testid="faucet-card">
            <div className="faucet-card-icon">
                <Drop size={24} weight="duotone" color="#00d4aa" />
            </div>
            <div className="faucet-card-content">
                <div className="faucet-card-title">
                    Get started with {FAUCET_AMOUNT_DISPLAY}
                </div>
                <div className="faucet-card-desc">{descText}</div>
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
