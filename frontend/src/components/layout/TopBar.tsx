import { CopyableAddress } from "../ui/CopyableAddress"
import { validateActiveRpcDomain } from "../../lib/config"
import { NotificationBell } from "./NotificationBell"
import type { Notification } from "../../lib/notifications"

// ── Types ──────────────────────────────────────────────────────────────
interface TopBarProps {
    adena: {
        connected: boolean
        address: string
        chainId: string
        rpcTrusted: boolean
        rpcUrl: string
        loading: boolean
        reconnecting: boolean
        installed: boolean
        connect: () => void
        pubkeyJSON: string
    }
    auth: {
        isAuthenticated: boolean
        address: string | null
    }
    compactBalance: string
    network: {
        networkKey: string
        chainId: string
        networks: Record<string, { label: string; chainId: string; rpcUrl: string }>
        switchNetwork: (key: string) => void
    }
    isLoggingIn: boolean
    authError: string | null
    onDisconnect: () => void
    onClearError: () => void
    notifications: {
        notifications: Notification[]
        unreadCount: number
        markRead: (id: string) => void
        markAllRead: () => void
    }
    /** Programmatically add + switch Adena wallet to a network. */
    addAndSwitchWalletNetwork?: (chainId: string, chainName: string, rpcUrl: string) => Promise<boolean>
    /** Callback when wallet network switch succeeds. */
    onWalletSwitchSuccess?: (chainName: string) => void
    /** B3: Toggle sidebar on tablet viewports. */
    onToggleSidebar?: () => void
}

// ── TopBar Component ───────────────────────────────────────────────────
export function TopBar({ adena, auth, compactBalance, network, isLoggingIn, authError, onDisconnect, onClearError, notifications, addAndSwitchWalletNetwork, onWalletSwitchSuccess, onToggleSidebar }: TopBarProps) {
    return (
        <>
            <header className="k-topbar" role="banner" data-testid="topbar">
                {/* B3: Hamburger toggle — visible only on tablet (768-1024px) via CSS */}
                {onToggleSidebar && (
                    <button
                        className="k-topbar-hamburger"
                        onClick={onToggleSidebar}
                        aria-label="Toggle sidebar"
                        title="Toggle sidebar"
                    >
                        ☰
                    </button>
                )}
                {/* Left: badges */}
                <div className="k-topbar-left">
                    <span className="k-version-badge" data-testid="alpha-badge" style={{
                        fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                        color: "#f5a623", background: "rgba(245,166,35,0.1)",
                        padding: "2px 6px", borderRadius: 4, letterSpacing: "0.05em",
                        border: "1px solid rgba(245,166,35,0.2)",
                    }}>Alpha</span>
                    <span className="k-version-badge" data-testid="version-badge" style={{
                        fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                        color: "#00d4aa", background: "rgba(0,212,170,0.08)",
                        padding: "2px 6px", borderRadius: 4, letterSpacing: "0.05em",
                    }}>v2</span>
                </div>

                {/* Right: network + wallet */}
                <div className="k-topbar-right">
                    {/* Network selector */}
                    <select
                        value={network.networkKey}
                        onChange={(e) => network.switchNetwork(e.target.value)}
                        title="Switch network"
                        style={{
                            background: "rgba(0,212,170,0.06)", border: "1px solid #1a1a1a",
                            color: "#888", fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                            padding: "4px 8px", borderRadius: 6, cursor: "pointer",
                            outline: "none", appearance: "none", WebkitAppearance: "none" as never,
                            backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%23555'/%3E%3C/svg%3E\")",
                            backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center",
                            paddingRight: 20,
                        }}
                    >
                        {Object.entries(network.networks).map(([key, net]) => (
                            <option key={key} value={key} style={{ background: "#111", color: "#ccc" }}>
                                {net.label}
                            </option>
                        ))}
                    </select>

                    {/* Notification bell (only when connected) */}
                    {adena.connected && auth.isAuthenticated && (
                        <NotificationBell
                            notifications={notifications.notifications}
                            unreadCount={notifications.unreadCount}
                            onMarkRead={notifications.markRead}
                            onMarkAllRead={notifications.markAllRead}
                        />
                    )}

                    {/* Wallet area */}
                    {adena.connected && auth.isAuthenticated ? (
                        <>
                            <span style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "#888" }}>
                                {compactBalance}
                            </span>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00d4aa" }} className="animate-glow" />
                                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <CopyableAddress address={auth.address || adena.address} compact={true} fontSize={12} />
                                </span>
                            </div>
                            <button
                                onClick={onDisconnect}
                                style={{
                                    padding: "6px 12px", borderRadius: 6,
                                    background: "none", border: "1px solid #333",
                                    color: "#888", fontSize: 11, cursor: "pointer",
                                    fontFamily: "JetBrains Mono, monospace",
                                }}
                            >
                                Disconnect
                            </button>
                        </>
                    ) : isLoggingIn ? (
                        <span className="k-btn-wallet" style={{ cursor: "default", opacity: 0.7 }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: adena.reconnecting ? "#00d4aa" : "#f59e0b" }} className="animate-glow" />
                            {adena.reconnecting ? "Syncing..." : "Authenticating..."}
                        </span>
                    ) : adena.reconnecting ? (
                        /* B3: Sync timed out — show retry */
                        <span className="k-btn-wallet" style={{ cursor: "pointer", opacity: 0.8, borderColor: "rgba(245,166,35,0.3)" }} onClick={() => window.location.reload()}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b" }} />
                            Sync timeout — Retry
                        </span>
                    ) : (
                        adena.installed ? (
                            <button className="k-btn-wallet" onClick={adena.connect} disabled={isLoggingIn}>
                                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00d4aa" }} />
                                Connect Wallet
                            </button>
                        ) : (
                            <a
                                href="https://adena.app"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="k-btn-wallet"
                                style={{ textDecoration: "none" }}
                            >
                                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b" }} />
                                Install Adena
                            </a>
                        )
                    )}
                </div>
            </header>

            {/* ── Auth error banner ──────────────────────────────── */}
            {authError && (
                <div style={{
                    background: "rgba(255,71,87,0.08)", borderBottom: "1px solid rgba(255,71,87,0.2)",
                    padding: "8px 24px", display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
                }}>
                    <span style={{ color: "#ff4757", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                        ⚠ {authError}
                    </span>
                    <button
                        onClick={onClearError}
                        style={{ color: "#888", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}
                    >
                        ×
                    </button>
                </div>
            )}

            {/* ── Chain mismatch warning ─────────────────────────── */}
            {adena.connected && adena.chainId && network.chainId !== adena.chainId && (
                <ChainMismatchBanner
                    walletChainId={adena.chainId}
                    membaChainId={network.chainId}
                    networks={network.networks}
                    switchMembaNetwork={network.switchNetwork}
                    addAndSwitchWallet={addAndSwitchWalletNetwork}
                    onSwitchSuccess={onWalletSwitchSuccess}
                />
            )}

            {/* ── Untrusted wallet RPC warning ──────────────────── */}
            {adena.connected && !adena.rpcTrusted && (
                <div className="k-security-banner">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 18 }}>🛡️</span>
                        <span style={{ color: "#ff4757", fontSize: 12, fontFamily: "JetBrains Mono, monospace", fontWeight: 700 }}>
                            SECURITY WARNING
                        </span>
                        <span style={{ color: "#ff8a94", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}>
                            — All transactions are blocked
                        </span>
                    </div>
                    <div style={{ color: "#ccc", fontSize: 11, textAlign: "center", marginTop: 6, lineHeight: 1.5 }}>
                        {adena.rpcUrl ? (
                            <>
                                Your wallet is connected to an untrusted RPC:{" "}
                                <code style={{ color: "#ff4757", background: "rgba(255,71,87,0.12)", padding: "2px 6px", borderRadius: 4, fontSize: 10 }}>
                                    {adena.rpcUrl}
                                </code>
                            </>
                        ) : (
                            <>Unable to verify your wallet&apos;s RPC URL.</>
                        )}
                        <br />
                        <span style={{ color: "#00d4aa", fontWeight: 600 }}>
                            Open Adena → Settings → Networks → switch to a *.gno.land RPC
                        </span>
                    </div>
                </div>
            )}

            {/* ── Defense-in-depth: config RPC check ────────────── */}
            {(() => {
                const rpcWarning = validateActiveRpcDomain()
                if (!rpcWarning || (adena.connected && !adena.rpcTrusted)) return null
                return (
                    <div style={{
                        background: "rgba(255,71,87,0.08)", borderBottom: "1px solid rgba(255,71,87,0.3)",
                        padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                    }}>
                        <span style={{ fontSize: 16 }}>🛡️</span>
                        <span style={{ color: "#ff4757", fontSize: 12, fontFamily: "JetBrains Mono, monospace", fontWeight: 600 }}>
                            SECURITY WARNING: {rpcWarning}
                        </span>
                    </div>
                )
            })()}
        </>
    )
}

// ── Chain Mismatch Banner ─────────────────────────────────────────────
import { useState } from "react"

function ChainMismatchBanner({
    walletChainId,
    membaChainId,
    networks,
    switchMembaNetwork,
    addAndSwitchWallet,
    onSwitchSuccess,
}: {
    walletChainId: string
    membaChainId: string
    networks: Record<string, { label: string; chainId: string; rpcUrl: string }>
    switchMembaNetwork: (key: string) => void
    addAndSwitchWallet?: (chainId: string, chainName: string, rpcUrl: string) => Promise<boolean>
    onSwitchSuccess?: (chainName: string) => void
}) {
    const [switching, setSwitching] = useState(false)

    const walletInMemba = !!networks[walletChainId]
    const membaNet = networks[Object.keys(networks).find(k => networks[k].chainId === membaChainId) || ""]

    const handleAddAndSwitch = async () => {
        if (!addAndSwitchWallet || !membaNet || switching) return
        setSwitching(true)
        try {
            const ok = await addAndSwitchWallet(membaNet.chainId, membaNet.label, membaNet.rpcUrl)
            if (ok) onSwitchSuccess?.(membaNet.label)
        } finally {
            setSwitching(false)
        }
    }

    return (
        <div style={{
            background: "rgba(245,166,35,0.06)", borderBottom: "1px solid rgba(245,166,35,0.15)",
            padding: "8px 24px", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexWrap: "wrap",
        }}>
            <span style={{ color: "#f5a623", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                ⚠ Network mismatch — wallet is on <strong>{walletChainId}</strong>, Memba is on <strong>{membaChainId}</strong>
            </span>
            {walletInMemba ? (
                <button
                    onClick={() => switchMembaNetwork(walletChainId)}
                    style={{
                        background: "rgba(245,166,35,0.12)", border: "1px solid rgba(245,166,35,0.3)",
                        color: "#f5a623", fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                        padding: "3px 10px", borderRadius: 4, cursor: "pointer",
                    }}
                >
                    Switch Memba to {walletChainId}
                </button>
            ) : addAndSwitchWallet && membaNet ? (
                <button
                    onClick={handleAddAndSwitch}
                    disabled={switching}
                    aria-busy={switching}
                    style={{
                        background: switching ? "rgba(245,166,35,0.06)" : "rgba(0,212,170,0.12)",
                        border: `1px solid ${switching ? "rgba(245,166,35,0.2)" : "rgba(0,212,170,0.3)"}`,
                        color: switching ? "#f5a623" : "#00d4aa",
                        fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                        padding: "3px 10px", borderRadius: 4,
                        cursor: switching ? "wait" : "pointer",
                        opacity: switching ? 0.7 : 1,
                    }}
                >
                    {switching ? "Switching…" : `Add & Switch Wallet to ${membaChainId}`}
                </button>
            ) : (
                <span style={{ color: "#888", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}>
                    Switch your wallet to {membaChainId} in Adena
                </span>
            )}
        </div>
    )
}
