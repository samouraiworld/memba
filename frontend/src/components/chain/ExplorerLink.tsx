/**
 * ExplorerLink — Universal block explorer link component.
 *
 * Renders links to GnoScan (Gno) or Blockscout (EVM) for
 * transactions, addresses, and contracts.
 *
 * @module components/chain/ExplorerLink
 */

import React from "react"
import { useChain } from "@/lib/chain"
import { getExplorerName, formatTxHash } from "@/lib/chain/tx"
import type { ChainAddress } from "@/lib/chain"

export interface ExplorerLinkProps {
    /** The type of link. */
    type: "tx" | "address"
    /** Transaction hash or address. */
    value: string | ChainAddress
    /** Custom label (defaults to truncated value). */
    label?: string
    /** Additional className. */
    className?: string
}

export function ExplorerLink({ type, value, label, className = "" }: ExplorerLinkProps) {
    const { provider, family } = useChain()
    const explorerName = getExplorerName(family)

    let url: string
    let displayText: string

    if (type === "tx") {
        const hash = typeof value === "string" ? value : value.raw
        url = provider.getExplorerTxUrl(hash)
        displayText = label ?? formatTxHash(hash)
    } else {
        const addr = typeof value === "string" ? value : value.raw
        const chainAddr = typeof value === "string"
            ? provider.parseAddress(value)
            : value
        url = provider.getExplorerAddressUrl(chainAddr)
        displayText = label ?? `${addr.slice(0, 6)}...${addr.slice(-4)}`
    }

    return React.createElement("a", {
        href: url,
        target: "_blank",
        rel: "noopener noreferrer",
        className: `explorer-link ${className}`,
        title: `View on ${explorerName}`,
    },
        React.createElement("span", { className: "explorer-link__text" }, displayText),
        React.createElement("span", { className: "explorer-link__icon", "aria-hidden": true }, "↗"),
    )
}
