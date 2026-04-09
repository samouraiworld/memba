import { useState, useEffect } from "react"
import { SunDim, Moon } from "@phosphor-icons/react"
import { CopyableAddress } from "../ui/CopyableAddress"
import { validateActiveRpcDomain } from "../../lib/config"
import { NotificationBell } from "./NotificationBell"
import type { Notification } from "../../lib/notifications"
import { completeQuest, getQuestWalletAddress } from "../../lib/quests"
import { trackNetworkVisit } from "../../lib/questVerifier"
import { getTheme, toggleTheme, type Theme } from "../../lib/themeStore"

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
                    <span className="k-topbar-badge k-topbar-badge--alpha" data-testid="alpha-badge">Alpha</span>
                    <span className="k-topbar-badge k-topbar-badge--version" data-testid="version-badge">v3</span>
                </div>

                {/* Right: network + wallet */}
                <div className="k-topbar-right">
                    {/* Theme toggle */}
                    <ThemeToggle />

                    {/* Network selector */}
                    <select
                        className="k-topbar-network-select"
                        value={network.networkKey}
                        onChange={(e) => {
                            completeQuest("switch-network")
                            const addr = getQuestWalletAddress()
                            if (addr) trackNetworkVisit(addr, e.target.value)
                            network.switchNetwork(e.target.value)
                        }}
                        title="Switch network"
                    >
                        {Object.entries(network.networks).map(([key, net]) => (
                            <option key={key} value={key}>
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
                            <span className="k-topbar-balance">
                                {compactBalance}
                            </span>
                            <div className="k-topbar-wallet-row">
                                <span className="k-status-dot k-status-dot--ok animate-glow" />
                                <span className="k-topbar-wallet-addr">
                                    <CopyableAddress address={auth.address || adena.address} compact={true} fontSize={12} />
                                </span>
                            </div>
                            <button className="k-topbar-disconnect" onClick={onDisconnect}>
                                Disconnect
                            </button>
                        </>
                    ) : isLoggingIn ? (
                        <span className="k-btn-wallet" style={{ cursor: "default", opacity: 0.7 }}>
                            <span className={`k-status-dot ${adena.reconnecting ? "k-status-dot--ok" : "k-status-dot--warn"} animate-glow`} />
                            {adena.reconnecting ? "Syncing..." : "Authenticating..."}
                        </span>
                    ) : adena.reconnecting ? (
                        /* B3: Sync timed out — show retry */
                        <span className="k-btn-wallet" style={{ cursor: "pointer", opacity: 0.8, borderColor: "rgba(245,166,35,0.3)" }} onClick={() => window.location.reload()}>
                            <span className="k-status-dot k-status-dot--warn" />
                            Sync timeout — Retry
                        </span>
                    ) : (
                        adena.installed ? (
                            <button className="k-btn-wallet" onClick={adena.connect} disabled={isLoggingIn}>
                                <span className="k-status-dot k-status-dot--ok" />
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
                                <span className="k-status-dot k-status-dot--warn" />
                                Install Adena
                            </a>
                        )
                    )}
                </div>
            </header>

            {/* ── Auth error banner ──────────────────────────────── */}
            {authError && (
                <div className="k-topbar-banner k-topbar-banner--error">
                    <span className="k-topbar-banner__text k-topbar-banner__text--error">
                        ⚠ {authError}
                    </span>
                    <button className="k-topbar-banner__dismiss" onClick={onClearError}>
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
                    <div className="k-security-banner__header">
                        <span style={{ fontSize: 18 }}>🛡️</span>
                        <span className="k-security-banner__title">
                            SECURITY WARNING
                        </span>
                        <span className="k-security-banner__subtitle">
                            — All transactions are blocked
                        </span>
                    </div>
                    <div className="k-security-banner__body">
                        {adena.rpcUrl ? (
                            <>
                                Your wallet is connected to an untrusted RPC:{" "}
                                <code className="k-security-banner__code">
                                    {adena.rpcUrl}
                                </code>
                            </>
                        ) : (
                            <>Unable to verify your wallet&apos;s RPC URL.</>
                        )}
                        <br />
                        <span className="k-security-banner__action">
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
                    <div className="k-topbar-banner k-topbar-banner--security">
                        <span style={{ fontSize: 16 }}>🛡️</span>
                        <span className="k-topbar-banner__text k-topbar-banner__text--error" style={{ fontWeight: 600 }}>
                            SECURITY WARNING: {rpcWarning}
                        </span>
                    </div>
                )
            })()}
        </>
    )
}

// ── Theme Toggle ──────────────────────────────────────────────────────

function ThemeToggle() {
    const [theme, setThemeState] = useState<Theme>(getTheme)

    // Sync with external changes (Settings page, Cmd+K)
    useEffect(() => {
        const observer = new MutationObserver(() => {
            setThemeState(getTheme())
        })
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
        return () => observer.disconnect()
    }, [])

    return (
        <button
            className="k-topbar-theme-toggle"
            onClick={() => {
                const next = toggleTheme()
                setThemeState(next)
            }}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme (⌘K)`}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        >
            {theme === "dark" ? <SunDim size={18} weight="bold" /> : <Moon size={18} weight="bold" />}
        </button>
    )
}

// ── Chain Mismatch Banner ─────────────────────────────────────────────

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
        <div className="k-topbar-banner k-topbar-banner--warning">
            <span className="k-topbar-banner__text k-topbar-banner__text--warning">
                ⚠ Network mismatch — wallet is on <strong>{walletChainId}</strong>, Memba is on <strong>{membaChainId}</strong>
            </span>
            {walletInMemba ? (
                <button
                    className="k-topbar-banner__btn k-topbar-banner__btn--warning"
                    onClick={() => switchMembaNetwork(walletChainId)}
                >
                    Switch Memba to {walletChainId}
                </button>
            ) : addAndSwitchWallet && membaNet ? (
                <button
                    className={`k-topbar-banner__btn ${switching ? "k-topbar-banner__btn--switching" : "k-topbar-banner__btn--accent"}`}
                    onClick={handleAddAndSwitch}
                    disabled={switching}
                    aria-busy={switching}
                >
                    {switching ? "Switching…" : `Add & Switch Wallet to ${membaChainId}`}
                </button>
            ) : (
                <span className="k-topbar-banner__text k-topbar-banner__text--muted">
                    Switch your wallet to {membaChainId} in Adena
                </span>
            )}
        </div>
    )
}
