/**
 * AddressDisplay — Chain-agnostic address display component.
 *
 * Renders Gno addresses (g1...) and EVM addresses (0x...) consistently
 * with truncation, copy-to-clipboard, and explorer links.
 *
 * @module components/chain/AddressDisplay
 */

import React, { useState, useCallback } from "react"
import { type ChainAddress, formatAddress, isGnoAddress, isEvmAddress, useChain } from "@/lib/chain"

export interface AddressDisplayProps {
    address: ChainAddress
    /** Show full address without truncation. */
    full?: boolean
    /** Show copy button. */
    copyable?: boolean
    /** Link to block explorer. */
    linked?: boolean
    /** Custom className. */
    className?: string
}

export function AddressDisplay({
    address,
    full = false,
    copyable = true,
    linked = true,
    className = "",
}: AddressDisplayProps) {
    const { provider } = useChain()
    const [copied, setCopied] = useState(false)

    const displayText = formatAddress(address, !full)
    const explorerUrl = linked ? provider.getExplorerAddressUrl(address) : null
    const familyBadge = isGnoAddress(address) ? "gno" : isEvmAddress(address) ? "evm" : "?"

    const handleCopy = useCallback(async () => {
        await navigator.clipboard.writeText(address.raw)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }, [address.raw])

    const textEl = React.createElement("span", {
        className: `address-display__text address-display__text--${familyBadge}`,
        title: address.raw,
    }, displayText)

    const inner = React.createElement(React.Fragment, null,
        textEl,
        copyable && React.createElement("button", {
            className: "address-display__copy",
            onClick: handleCopy,
            "aria-label": "Copy address",
            title: copied ? "Copied!" : "Copy address",
        }, copied ? "✓" : "📋"),
    )

    if (linked && explorerUrl) {
        return React.createElement("span", { className: `address-display ${className}` },
            React.createElement("a", {
                href: explorerUrl,
                target: "_blank",
                rel: "noopener noreferrer",
                className: "address-display__link",
            }, textEl),
            copyable && React.createElement("button", {
                className: "address-display__copy",
                onClick: handleCopy,
                "aria-label": "Copy address",
                title: copied ? "Copied!" : "Copy address",
            }, copied ? "✓" : "📋"),
        )
    }

    return React.createElement("span", { className: `address-display ${className}` }, inner)
}
