/**
 * TokenDetailDrawer — Slide-in panel for quick token preview.
 *
 * Reuses the drawer CSS from directory.css.
 * Shows token info + links to full TokenView and gnoweb.
 *
 * @module components/directory/TokenDetailDrawer
 */

import { useState, useEffect, useCallback } from "react"
import { useNetworkNav } from "../../hooks/useNetworkNav"
import { useNetwork } from "../../hooks/useNetwork"
import type { DirectoryToken } from "../../lib/directory"
import { getGnowebUrl } from "../../lib/gnoweb"

interface TokenDetailDrawerProps {
    token: DirectoryToken
    onClose: () => void
}

export function TokenDetailDrawer({ token, onClose }: TokenDetailDrawerProps) {
    const navigate = useNetworkNav()
    const { networkKey } = useNetwork()
    const [visible, setVisible] = useState(false)

    const handleClose = useCallback(() => {
        setVisible(false)
        setTimeout(onClose, 250)
    }, [onClose])

    useEffect(() => {
        requestAnimationFrame(() => setVisible(true))
    }, [])

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") handleClose()
        }
        document.addEventListener("keydown", handler)
        return () => document.removeEventListener("keydown", handler)
    }, [handleClose])

    // P1 fix: use active network key instead of hardcoded "gnoland1"
    const gnowebBase = getGnowebUrl(networkKey) || "https://gno.land"
    const tokenPath = token.path.replace("gno.land", "")

    return (
        <div
            className={`drawer-overlay${visible ? " visible" : ""}`}
            onClick={handleClose}
        >
            <div
                className={`drawer-panel${visible ? " visible" : ""}`}
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={`${token.name} details`}
            >
                {/* Header */}
                <div className="drawer-header">
                    <div className="drawer-header__info">
                        <h2 className="drawer-header__title">{token.name}</h2>
                        <span className="drawer-header__path">${token.symbol}</span>
                    </div>
                    <button className="drawer-close" onClick={handleClose} aria-label="Close">
                        ✕
                    </button>
                </div>

                {/* Content */}
                <div className="drawer-content">
                    <div className="token-drawer-hero">
                        <div className="dir-token-avatar token-drawer-avatar">
                            {token.symbol.charAt(0)}
                        </div>
                        <div className="token-drawer-info">
                            <div className="token-drawer-name">{token.name}</div>
                            <div className="token-drawer-symbol">${token.symbol}</div>
                            {token.path && (
                                <div className="token-drawer-path">{token.path}</div>
                            )}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="drawer-links" style={{ paddingTop: 20 }}>
                        <button
                            className="token-drawer-action"
                            onClick={() => {
                                handleClose()
                                navigate(`/tokens/${token.symbol}`)
                            }}
                        >
                            View Full Details →
                        </button>
                        {tokenPath && (
                            <a
                                href={`${gnowebBase}${tokenPath}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="drawer-links__item"
                            >
                                Open in gnoweb →
                            </a>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
