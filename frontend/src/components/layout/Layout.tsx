import { useEffect, useRef, useCallback, useState } from "react"
import { Outlet, Link } from "react-router-dom"
import { useAdena } from "../../hooks/useAdena"
import { useBalance } from "../../hooks/useBalance"
import { useAuth } from "../../hooks/useAuth"
import { useNetwork } from "../../hooks/useNetwork"
import { CopyableAddress } from "../ui/CopyableAddress"
import { ConnectingLoader } from "../ui/ConnectingLoader"
import { APP_VERSION, NETWORKS, validateActiveRpcDomain } from "../../lib/config"
import { useUnvotedCount } from "../../hooks/useUnvotedCount"

// Must exactly match backend auth.ClientMagic constant.
const CLIENT_MAGIC = "Login to Memba Multisig Service"

// Encode Uint8Array to base64 string (protojson format for bytes fields)
function bytesToBase64(bytes: Uint8Array): string {
    let binary = ""
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
}

export function Layout() {
    const adena = useAdena()
    const auth = useAuth()
    const { balance, compactBalance } = useBalance(adena.connected ? adena.address : null)
    const network = useNetwork()
    const [authLoading, setAuthLoading] = useState(false)
    const [authError, setAuthError] = useState<string | null>(null)
    const loginAttemptedRef = useRef(false)

    // ── Auth bridge: wallet connect → challenge-response → token ──
    const performLogin = useCallback(async () => {
        if (!adena.connected || auth.isAuthenticated) return
        if (loginAttemptedRef.current) return
        loginAttemptedRef.current = true
        setAuthLoading(true)
        setAuthError(null)

        try {
            // 1. Get server challenge
            const challenge = await auth.getChallenge()
            if (!challenge) throw new Error("Failed to get challenge")

            // 2. Build TokenRequestInfo (protojson format)
            const info: Record<string, unknown> = {
                kind: CLIENT_MAGIC,
                challenge: {
                    nonce: bytesToBase64(challenge.nonce),
                    expiration: challenge.expiration,
                    serverSignature: bytesToBase64(challenge.serverSignature),
                },
                userBech32Prefix: "g",
            }
            // Send pubkey if available, otherwise use address-only auth
            if (adena.pubkeyJSON) {
                info.userPubkeyJson = adena.pubkeyJSON
            } else {
                info.userAddress = adena.address
            }
            const infoJson = JSON.stringify(info)

            // 3. ADR-036 signing skipped — Adena returns UNSUPPORTED_TYPE for sign/MsgSignData
            const signature = ""

            // 4. Exchange for auth token
            const token = await auth.getToken(infoJson, signature)
            if (!token) throw new Error("Authentication failed")
        } catch (err) {
            console.error("[Memba] Login failed:", err)
            setAuthError(err instanceof Error ? err.message : "Login failed")
            adena.disconnect()
        } finally {
            setAuthLoading(false)
        }
    }, [adena, auth])

    useEffect(() => {
        if (adena.connected && !auth.isAuthenticated && !authLoading) {
            performLogin()
        }
        // S1: When wallet is not connected, clear any persisted auth token.
        // This prevents stale data from showing on hard refresh without wallet.
        // BUT: don't clear during auto-reconnect — give adena time to restore.
        if (!adena.connected && auth.isAuthenticated && !adena.reconnecting) {
            auth.logout()
        }
        // Reset login gate when wallet disconnects
        if (!adena.connected) {
            loginAttemptedRef.current = false
        }
    }, [adena.connected, adena.reconnecting, auth.isAuthenticated, authLoading, performLogin, auth])

    // ── Address mismatch: Adena switched accounts but old token persists ──
    useEffect(() => {
        if (!adena.connected || !auth.isAuthenticated) return
        if (adena.address && auth.address && adena.address !== auth.address) {
            // Stale token from different account — clear and re-authenticate
            auth.logout()
            loginAttemptedRef.current = false
        }
    }, [adena.connected, adena.address, auth.isAuthenticated, auth.address, auth])

    // ── Listen for Adena account changes (user switches wallet in extension) ──
    useEffect(() => {
        const adenaGlobal = (window as unknown as Record<string, unknown>).adena
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!adenaGlobal || typeof (adenaGlobal as any).On !== "function") return

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const off = (adenaGlobal as any).On("changedAccount", () => {
            // Account changed in Adena — clear everything and reconnect
            auth.logout()
            adena.disconnect()
            loginAttemptedRef.current = false
        })
        return () => { if (typeof off === "function") off() }
    }, [adena, auth])

    // ── Disconnect: also clear auth ──
    const handleDisconnect = useCallback(() => {
        adena.disconnect()
        auth.logout()
        setAuthError(null)
        loginAttemptedRef.current = false
    }, [adena, auth])



    const isLoggingIn = adena.loading || authLoading || auth.loading || adena.reconnecting
    const { unvotedCount } = useUnvotedCount(adena.connected ? adena.address : null)

    return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#000", color: "#f0f0f0" }}>
            {/* ── Header ──────────────────────────────────────────────── */}
            <header role="banner" className="k-glass" style={{ position: "sticky", top: 0, zIndex: 50, borderBottom: "1px solid #1a1a1a" }}>
                <div className="k-header-content" style={{ maxWidth: 1152, margin: "0 auto", padding: "0 24px", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    {/* Logo — clickable to home */}
                    <Link to={auth.isAuthenticated ? "/dashboard" : "/"} aria-label="Memba home" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", color: "inherit" }}>
                        <div
                            className="animate-glow"
                            style={{
                                width: 36, height: 36, borderRadius: 8,
                                border: "1px dashed rgba(0,212,170,0.35)",
                                background: "rgba(0,212,170,0.06)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                            }}
                        >
                            <span style={{ color: "#00d4aa", fontFamily: "JetBrains Mono, monospace", fontSize: 14, fontWeight: 700 }}>M</span>
                        </div>
                        <span style={{ fontWeight: 600, fontSize: 18, letterSpacing: "-0.03em" }}>Memba</span>
                        <span className="k-version-badge" style={{
                            fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                            color: "#f5a623", background: "rgba(245,166,35,0.1)",
                            padding: "2px 6px", borderRadius: 4, letterSpacing: "0.05em",
                            border: "1px solid rgba(245,166,35,0.2)",
                        }}>Alpha</span>
                        <span className="k-version-badge" style={{
                            fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                            color: "#00d4aa", background: "rgba(0,212,170,0.08)",
                            padding: "2px 6px", borderRadius: 4, letterSpacing: "0.05em",
                        }}>v{APP_VERSION}</span>
                    </Link>

                    {/* Nav links */}
                    <nav aria-label="Main navigation" className="k-header-nav" style={{ display: "flex", gap: 16, alignItems: "center" }}>
                        {adena.connected && (
                            <Link to="/dashboard" style={{ color: "#888", fontSize: 12, fontFamily: "JetBrains Mono, monospace", textDecoration: "none", transition: "color 0.15s" }} onMouseEnter={e => e.currentTarget.style.color = "#00d4aa"} onMouseLeave={e => e.currentTarget.style.color = "#888"}>
                                🏠 <span className="k-nav-label">Dashboard</span>
                            </Link>
                        )}
                        <Link to="/tokens" style={{ color: "#888", fontSize: 12, fontFamily: "JetBrains Mono, monospace", textDecoration: "none", transition: "color 0.15s" }} onMouseEnter={e => e.currentTarget.style.color = "#00d4aa"} onMouseLeave={e => e.currentTarget.style.color = "#888"}>
                            🪙 <span className="k-nav-label">Tokens</span>
                        </Link>
                        <Link to="/dao" style={{ color: "#888", fontSize: 12, fontFamily: "JetBrains Mono, monospace", textDecoration: "none", transition: "color 0.15s", position: "relative" }} onMouseEnter={e => e.currentTarget.style.color = "#00d4aa"} onMouseLeave={e => e.currentTarget.style.color = "#888"} title={unvotedCount > 0 ? `${unvotedCount} unvoted proposal${unvotedCount > 1 ? "s" : ""}` : undefined}>
                            🏛️ <span className="k-nav-label">DAO</span>
                            {unvotedCount > 0 && <span className="k-notif-dot" />}
                        </Link>
                        {adena.connected && adena.address && (
                            <Link to={`/profile/${adena.address}`} style={{ color: "#888", fontSize: 12, fontFamily: "JetBrains Mono, monospace", textDecoration: "none", transition: "color 0.15s" }} onMouseEnter={e => e.currentTarget.style.color = "#00d4aa"} onMouseLeave={e => e.currentTarget.style.color = "#888"}>
                                👤 <span className="k-nav-label">Profile</span>
                            </Link>
                        )}
                    </nav>

                    {/* Right side */}
                    <div className="k-header-right" style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                        {/* Network selector */}
                        <select
                            value={network.networkKey}
                            onChange={(e) => network.switchNetwork(e.target.value)}
                            title="Switch network"
                            style={{
                                background: "rgba(0,212,170,0.06)", border: "1px solid #1a1a1a",
                                color: "#888", fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                                padding: "4px 8px", borderRadius: 6, cursor: "pointer",
                                outline: "none", appearance: "none", WebkitAppearance: "none",
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
                                    onClick={handleDisconnect}
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
                </div>
            </header >

            {/* ── Auth error banner ────────────────────────────────────── */}
            {
                authError && (
                    <div style={{
                        background: "rgba(255,71,87,0.08)", borderBottom: "1px solid rgba(255,71,87,0.2)",
                        padding: "8px 24px", display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
                    }}>
                        <span style={{ color: "#ff4757", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                            ⚠ {authError}
                        </span>
                        <button
                            onClick={() => setAuthError(null)}
                            style={{ color: "#888", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}
                        >
                            ×
                        </button>
                    </div>
                )
            }

            {/* ── Chain mismatch warning ───────────────────────────────── */}
            {
                adena.connected && adena.chainId && network.chainId !== adena.chainId && (
                    <div style={{
                        background: "rgba(245,166,35,0.06)", borderBottom: "1px solid rgba(245,166,35,0.15)",
                        padding: "8px 24px", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexWrap: "wrap",
                    }}>
                        <span style={{ color: "#f5a623", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                            ⚠ Network mismatch — wallet is on <strong>{adena.chainId}</strong>, Memba is on <strong>{network.chainId}</strong>
                        </span>
                        {NETWORKS[adena.chainId] ? (
                            <button
                                onClick={() => network.switchNetwork(adena.chainId)}
                                style={{
                                    background: "rgba(245,166,35,0.12)", border: "1px solid rgba(245,166,35,0.3)",
                                    color: "#f5a623", fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                                    padding: "3px 10px", borderRadius: 4, cursor: "pointer",
                                }}
                            >
                                Switch Memba to {adena.chainId}
                            </button>
                        ) : (
                            <span style={{ color: "#888", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}>
                                Switch your wallet to {network.chainId} in Adena
                            </span>
                        )}
                    </div>
                )
            }

            {/* ── Untrusted wallet RPC warning ─────────────────────────── */}
            {
                adena.connected && !adena.rpcTrusted && (
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
                )
            }
            {/* Defense-in-depth: also check Memba's own config */}
            {
                (() => {
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
                })()
            }

            {/* ── Main ────────────────────────────────────────────────── */}
            <main className="k-main" style={{ flex: 1, maxWidth: 1152, margin: "0 auto", padding: "32px 24px", width: "100%" }}>
                {isLoggingIn ? (
                    <ConnectingLoader />
                ) : (
                    <Outlet context={{ adena, balance, auth: { token: auth.token, isAuthenticated: auth.isAuthenticated, address: auth.address, loading: authLoading || auth.loading, error: authError } }} />
                )}
            </main>

            {/* ── Footer ──────────────────────────────────────────────── */}
            <footer style={{ borderTop: "1px solid #111", padding: "16px 24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                    {[
                        { href: "https://x.com/samouraicoop", label: "X", icon: "𝕏" },
                        { href: "https://instagram.com/samourai.tv", label: "Instagram", icon: "◻" },
                        { href: "https://samourai.tv/", label: "YouTube", icon: "▶" },
                        { href: "https://github.com/samouraiworld/memba", label: "GitHub", icon: <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg> },
                        { href: "https://www.linkedin.com/company/samouraicoop/", label: "LinkedIn", icon: "in" },
                        { href: "https://t.me/samouraicoop", label: "Telegram", icon: "✈" },
                        { href: "mailto:support@samourai.coop", label: "Email", icon: "✉" },
                    ].map(({ href, label, icon }) => (
                        <a
                            key={label}
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={label}
                            style={{
                                color: "#444", fontSize: 13, textDecoration: "none",
                                transition: "color 0.2s", fontFamily: "system-ui, sans-serif",
                            }}
                            onMouseOver={(e) => (e.currentTarget.style.color = "#00d4aa")}
                            onMouseOut={(e) => (e.currentTarget.style.color = "#444")}
                        >
                            {icon}
                        </a>
                    ))}
                </div>
                <p style={{ color: "#333", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}>
                    memba v{APP_VERSION} • built by samourai coop
                </p>
                <p style={{ color: "#444", fontSize: 9, fontFamily: "JetBrains Mono, monospace", maxWidth: 500, lineHeight: 1.4 }}>
                    ⚠️ Alpha — experimental open-source software for the gno.land ecosystem.
                    Unaudited, under active development. Use at your own risk.{" "}
                    <a href="https://github.com/sponsors/samouraiworld" target="_blank" rel="noopener noreferrer" style={{ color: "#00d4aa" }}>
                        Tips & sponsorships
                    </a>{" "}welcome.
                </p>
            </footer>
        </div >
    )
}

