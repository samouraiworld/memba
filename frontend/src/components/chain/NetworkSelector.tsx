/**
 * NetworkSelector — Chain/network switcher component.
 *
 * Displays the active network with an indicator and allows switching
 * between Gno testnets, Robinhood Chain testnet, and mainnet.
 *
 * Usage:
 * ```tsx
 * <NetworkSelector />
 * ```
 *
 * @module components/NetworkSelector
 */

import React, { useState, useCallback, useRef, useEffect } from "react"
import { useChain, type ChainId } from "../../lib/chain"

export function NetworkSelector() {
    const { network, switchChain, availableNetworks, isLoading } = useChain()
    const [isOpen, setIsOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)

    // Close on outside click
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClick)
        return () => document.removeEventListener("mousedown", handleClick)
    }, [])

    const handleSwitch = useCallback(async (chainId: ChainId) => {
        setIsOpen(false)
        await switchChain(chainId)
    }, [switchChain])

    const familyIcon = network.family === "gno" ? "🟢" : "🔵"
    const testnetBadge = network.isTestnet ? " (testnet)" : ""

    return React.createElement("div", {
        ref,
        className: "network-selector",
        style: { position: "relative", display: "inline-block" },
    },
        React.createElement("button", {
            className: "network-selector__trigger",
            onClick: () => setIsOpen(!isOpen),
            disabled: isLoading,
            "aria-label": "Select network",
            "aria-expanded": isOpen,
        }, `${familyIcon} ${network.label}${testnetBadge}`),

        isOpen && React.createElement("ul", {
            className: "network-selector__dropdown",
            role: "listbox",
        },
            availableNetworks.map(n =>
                React.createElement("li", {
                    key: n.chainId,
                    role: "option",
                    "aria-selected": n.chainId === network.chainId,
                    className: `network-selector__option ${n.chainId === network.chainId ? "network-selector__option--active" : ""}`,
                    onClick: () => handleSwitch(n.chainId),
                },
                    `${n.family === "gno" ? "🟢" : "🔵"} ${n.label}${n.isTestnet ? " (testnet)" : ""}`,
                ),
            ),
        ),
    )
}
