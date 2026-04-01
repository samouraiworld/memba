/**
 * ConnectWalletPrompt — Modal prompt for write actions when not connected.
 *
 * Sprint 11: Shown instead of blocking navigation. Users can browse freely
 * but see this prompt when attempting write actions (create, vote, transfer).
 */

import { useEffect } from "react"
import "./connectwalletprompt.css"

interface ConnectWalletPromptProps {
    onConnect: () => void
    onClose: () => void
    action?: string
}

export function ConnectWalletPrompt({ onConnect, onClose, action }: ConnectWalletPromptProps) {
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
        document.addEventListener("keydown", handleKey)
        return () => document.removeEventListener("keydown", handleKey)
    }, [onClose])

    return (
        <div className="cwp-overlay" onClick={onClose}>
            <div className="cwp-modal" onClick={e => e.stopPropagation()}>
                <button className="cwp-close" onClick={onClose}>×</button>
                <div className="cwp-icon">🔐</div>
                <h3 className="cwp-title">Connect Wallet</h3>
                <p className="cwp-desc">
                    {action
                        ? `You need to connect your wallet to ${action}.`
                        : "Connect your Adena wallet to interact with gno.land."}
                </p>
                <p className="cwp-hint">
                    You can browse and explore everything without a wallet. Only write actions require a connection.
                </p>
                <div className="cwp-actions">
                    <button className="cwp-btn cwp-btn--primary" onClick={onConnect}>
                        Connect Wallet
                    </button>
                    <button className="cwp-btn cwp-btn--secondary" onClick={onClose}>
                        Continue Browsing
                    </button>
                </div>
            </div>
        </div>
    )
}
