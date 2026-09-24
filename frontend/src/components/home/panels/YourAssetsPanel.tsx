import { Wallet } from "@phosphor-icons/react"
import { useAdena } from "../../../hooks/useAdena"
import { useBalance } from "../../../hooks/useBalance"
import { formatGnotCompact } from "../../../lib/formatGnot"
import { useNetworkPath } from "../../../hooks/useNetworkNav"
import { useNetwork } from "../../../hooks/useNetwork"
import { GNO_FAUCET_URL, isTestnetNetwork } from "../../../lib/config"
import { Door } from "../Door"
import "../home.css"

/**
 * YourAssetsPanel — Member-only panel showing user balances and assets.
 */
export function YourAssetsPanel() {
    const adena = useAdena()
    const { rawUgnot } = useBalance(adena.connected ? adena.address : null)
    const np = useNetworkPath()
    const { networkKey, label } = useNetwork()
    // The active network's own label ("gno.land" on mainnet); test chains say so.
    const networkName = isTestnetNetwork(networkKey) && !/testnet/i.test(label) ? `${label} testnet` : label

    // If not connected, or we haven't loaded balances, just return null or empty state
    if (!adena.connected) return null

    // For now, we only have native GNOT from the wallet object.
    // In a future wave, we can query GRC20 and GRC721 balances from the hub.
    const hasUgnot = typeof rawUgnot === "bigint" && rawUgnot > 0n

    return (
        <div className="your-worlds-panel" data-testid="your-assets-panel">
            {/* Panel title header */}
            <div className="panel-title-row">
                <Wallet size={16} aria-hidden="true" />
                <h3>Your Assets</h3>
            </div>

            <div className="your-worlds-board">
                {hasUgnot ? (
                    <a 
                        href={np(`profile/${adena.address}?tab=assets`)}
                        className="k-card" 
                        style={{ display: "flex", alignItems: "center", gap: "16px", textDecoration: "none", color: "inherit", padding: "16px", transition: "transform 0.2s ease, border-color 0.2s ease" }}
                    >
                        <div style={{ width: "48px", height: "48px", borderRadius: "8px", background: "var(--color-bg-tertiary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px" }}>
                            💰
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text)" }}>Native Balance</div>
                            <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }} data-testid="your-assets-network">{networkName}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-primary)" }}>
                                {formatGnotCompact(rawUgnot)}
                            </div>
                        </div>
                    </a>
                ) : (
                    <Door
                        variant="invitation"
                        state="empty"
                        eyebrow="no native tokens"
                        // Only a network with a faucet can offer free GNOT (mainnet has none).
                        invitation={GNO_FAUCET_URL ? { label: "Get testnet GNOT", href: GNO_FAUCET_URL } : undefined}
                    />
                )}

                {/* NFT Placeholder Door for future implementation */}
                <Door
                    variant="invitation"
                    state="empty"
                    eyebrow="no digital assets"
                    invitation={{ label: "View Portfolio", href: np(`profile/${adena.address}?tab=assets`) }}
                />
            </div>
        </div>
    )
}
