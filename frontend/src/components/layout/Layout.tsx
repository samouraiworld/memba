import { useEffect, useRef, useCallback, useState } from "react"
import { Outlet } from "react-router-dom"
import { useAdena } from "../../hooks/useAdena"
import { useBalance } from "../../hooks/useBalance"
import { useAuth } from "../../hooks/useAuth"

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
    const { balance } = useBalance(adena.connected ? adena.address : null)
    const [authLoading, setAuthLoading] = useState(false)
    const [authError, setAuthError] = useState<string | null>(null)
    const loginAttemptedRef = useRef(false)

    // ── Auth bridge: wallet connect → challenge-response → token ──
    const performLogin = useCallback(async () => {
        if (!adena.connected || !adena.pubkeyJSON || auth.isAuthenticated) return
        if (loginAttemptedRef.current) return
        loginAttemptedRef.current = true
        setAuthLoading(true)
        setAuthError(null)

        try {
            // 1. Get server challenge
            const challenge = await auth.getChallenge()
            if (!challenge) throw new Error("Failed to get challenge")

            // 2. Build TokenRequestInfo JSON (must be valid protojson)
            // Proto bytes fields must be base64-encoded for protojson.Unmarshal
            const info = {
                kind: CLIENT_MAGIC,
                challenge: {
                    nonce: bytesToBase64(challenge.nonce),
                    expiration: challenge.expiration,
                    serverSignature: bytesToBase64(challenge.serverSignature),
                },
                userBech32Prefix: "g",
                userPubkeyJson: adena.pubkeyJSON,
            }
            const infoJson = JSON.stringify(info)

            // 3. Sign with Adena (ADR-036)
            const signature = await adena.signArbitrary(infoJson)
            if (!signature) {
                throw new Error("Signature rejected")
            }

            // 4. Exchange for auth token
            const token = await auth.getToken(infoJson, signature)
            if (!token) throw new Error("Authentication failed")
        } catch (err) {
            setAuthError(err instanceof Error ? err.message : "Login failed")
            adena.disconnect()
        } finally {
            setAuthLoading(false)
        }
    }, [adena.connected, adena.pubkeyJSON, auth.isAuthenticated, auth.getChallenge, auth.getToken, adena.signArbitrary, adena.disconnect])

    useEffect(() => {
        if (adena.connected && !auth.isAuthenticated && !authLoading) {
            performLogin()
        }
        // Reset login gate when wallet disconnects
        if (!adena.connected) {
            loginAttemptedRef.current = false
        }
    }, [adena.connected, auth.isAuthenticated, authLoading, performLogin])

    // ── Disconnect: also clear auth ──
    const handleDisconnect = useCallback(() => {
        adena.disconnect()
        auth.logout()
        setAuthError(null)
        loginAttemptedRef.current = false
    }, [adena.disconnect, auth.logout])

    const truncateAddr = (addr: string) =>
        addr.length > 16 ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : addr

    const isLoggingIn = adena.loading || authLoading || auth.loading

    return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#000", color: "#f0f0f0" }}>
            {/* ── Header ──────────────────────────────────────────────── */}
            <header className="k-glass" style={{ position: "sticky", top: 0, zIndex: 50, borderBottom: "1px solid #1a1a1a" }}>
                <div className="k-header-content" style={{ maxWidth: 1152, margin: "0 auto", padding: "0 24px", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    {/* Logo */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
                        <span style={{
                            fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                            color: "#00d4aa", background: "rgba(0,212,170,0.08)",
                            padding: "2px 6px", borderRadius: 4, letterSpacing: "0.05em",
                        }}>v0.2.2</span>
                    </div>

                    {/* Right side */}
                    <div className="k-header-right" style={{ display: "flex", alignItems: "center", gap: 16 }}>
                        {adena.connected && auth.isAuthenticated ? (
                            <>
                                <span style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "#888" }}>
                                    {balance}
                                </span>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00d4aa" }} className="animate-glow" />
                                    <span style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "#ccc" }}>
                                        {truncateAddr(auth.address || adena.address)}
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
                                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b" }} className="animate-glow" />
                                Authenticating...
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
            </header>

            {/* ── Auth error banner ────────────────────────────────────── */}
            {authError && (
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
            )}

            {/* ── Main ────────────────────────────────────────────────── */}
            <main className="k-main" style={{ flex: 1, maxWidth: 1152, margin: "0 auto", padding: "32px 24px", width: "100%" }}>
                <Outlet context={{ adena, balance, auth: { token: auth.token, isAuthenticated: auth.isAuthenticated, address: auth.address, loading: authLoading || auth.loading, error: authError } }} />
            </main>

            {/* ── Footer ──────────────────────────────────────────────── */}
            <footer style={{ borderTop: "1px solid #111", padding: "16px 24px", textAlign: "center" }}>
                <p style={{ color: "#333", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}>
                    memba v0.2.2 • built by samourai coop
                </p>
            </footer>
        </div>
    )
}

