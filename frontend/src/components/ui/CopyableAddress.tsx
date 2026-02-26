import { useState } from "react"

interface CopyableAddressProps {
    address: string
    /** Show full address or truncate. Default: true (full) */
    full?: boolean
    /** Font size override. Default: 11 */
    fontSize?: number
}

/**
 * Displays a Gno address with 1-click copy.
 * Shows the full address by default; click copies to clipboard.
 */
export function CopyableAddress({ address, full = true, fontSize = 11 }: CopyableAddressProps) {
    const [copied, setCopied] = useState(false)

    const display = full
        ? address
        : address.length > 20
            ? `${address.slice(0, 10)}…${address.slice(-8)}`
            : address

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation() // prevent card click bubbling
        navigator.clipboard.writeText(address)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }

    return (
        <span
            onClick={handleCopy}
            title={copied ? "Copied!" : `Click to copy: ${address}`}
            style={{
                fontSize,
                fontFamily: "JetBrains Mono, monospace",
                color: copied ? "#00d4aa" : "#888",
                cursor: "pointer",
                wordBreak: "break-all",
                transition: "color 0.15s",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
            }}
        >
            {display}
            <span style={{ fontSize: fontSize - 1, opacity: copied ? 1 : 0.4, transition: "opacity 0.15s" }}>
                {copied ? "✓" : "📋"}
            </span>
        </span>
    )
}
