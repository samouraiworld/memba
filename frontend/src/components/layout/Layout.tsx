import { useEffect, useRef, useCallback, useState, useMemo } from "react"
import { Outlet } from "react-router-dom"
import { useAdena } from "../../hooks/useAdena"
import { useBalance } from "../../hooks/useBalance"
import { useAuth } from "../../hooks/useAuth"
import { useNetwork } from "../../hooks/useNetwork"
import { useUnvotedCount } from "../../hooks/useUnvotedCount"
import { useNotifications } from "../../hooks/useNotifications"
import { getSavedDAOs } from "../../lib/daoSlug"
import { Sidebar } from "./Sidebar"
import { TopBar } from "./TopBar"
import { MobileTabBar } from "./MobileTabBar"
import { CommandPalette } from "../ui/CommandPalette"
import { ConnectingLoader } from "../ui/ConnectingLoader"
import { JitsiProvider } from "../../contexts/JitsiContext"
import { OrgProvider } from "../../contexts/OrgContext"
import { JitsiPiPOverlay } from "../ui/JitsiPiPOverlay"
import { WhatsNewToast } from "../ui/WhatsNewToast"


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
    const { compactBalance, balance } = useBalance(adena.connected ? adena.address : null)
    const network = useNetwork()
    const [authLoading, setAuthLoading] = useState(false)
    const [authError, setAuthError] = useState<string | null>(null)
    const [walletSwitchMsg, setWalletSwitchMsg] = useState<string | null>(null)
    const loginAttemptedRef = useRef(false)

    // ── Sidebar collapse state (persisted to localStorage) ──
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
        localStorage.getItem("k-sidebar-collapsed") === "true"
    )

    const handleToggleCollapse = useCallback(() => {
        setSidebarCollapsed(prev => {
            const next = !prev
            localStorage.setItem("k-sidebar-collapsed", String(next))
            return next
        })
    }, [])

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

    // ── B3: Syncing timeout — after 10s of reconnecting, stop blocking ──
    const [syncTimedOut, setSyncTimedOut] = useState(false)
    useEffect(() => {
        if (!adena.reconnecting) {
            setSyncTimedOut(false)
            return
        }
        const timer = setTimeout(() => setSyncTimedOut(true), 10_000)
        return () => clearTimeout(timer)
    }, [adena.reconnecting])

    const isLoggingIn = !syncTimedOut && (adena.loading || authLoading || auth.loading || adena.reconnecting)
    const { unvotedCount } = useUnvotedCount(adena.connected ? adena.address : null)

    // Multi-DAO notification polling: poll all saved DAOs
    const savedDaoPaths = useMemo(
        () => adena.connected ? getSavedDAOs().map(d => d.realmPath) : [],
        // Re-compute when auth state changes (user may save new DAOs)
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [adena.connected, auth.isAuthenticated],
    )
    const notifs = useNotifications(savedDaoPaths, adena.connected ? adena.address : null)

    return (
        <OrgProvider>
        <JitsiProvider>
            <div className={`k-app-layout${sidebarCollapsed ? " k-sidebar-collapsed" : ""}`}>
                {/* Skip to content (accessibility — focus-only) */}
                <a href="#main-content" className="k-skip-to-content">
                    Skip to content
                </a>

                {/* ── Sidebar ──────────────────────────────────────── */}
                <Sidebar
                    connected={adena.connected}
                    address={auth.address || adena.address}
                    unvotedCount={unvotedCount}
                    notifUnreadCount={notifs.unreadCount}
                    collapsed={sidebarCollapsed}
                    onToggleCollapse={handleToggleCollapse}
                />

                {/* ── Main column ──────────────────────────────────── */}
                <div className="k-main-column">
                    <TopBar
                        adena={adena}
                        auth={auth}
                        compactBalance={compactBalance}
                        network={network}
                        isLoggingIn={isLoggingIn}
                        authError={authError}
                        onDisconnect={handleDisconnect}
                        onClearError={() => setAuthError(null)}
                        notifications={notifs}
                        onToggleSidebar={handleToggleCollapse}
                        addAndSwitchWalletNetwork={async (chainId, chainName, rpcUrl) => {
                            return adena.switchWalletNetwork(chainId, chainName, rpcUrl)
                        }}
                        onWalletSwitchSuccess={(chainName) => {
                            setWalletSwitchMsg(`✅ Wallet switched to ${chainName}`)
                            setTimeout(() => setWalletSwitchMsg(null), 3000)
                        }}
                    />

                    {/* ── Main ─────────────────────────────────────── */}
                    <main id="main-content" className="k-main">
                        {/* B8: Universal guard — show loader while wallet is syncing */}
                        {isLoggingIn ? (
                            <ConnectingLoader />
                        ) : (
                            <Outlet context={{ adena, balance, auth: { token: auth.token, isAuthenticated: auth.isAuthenticated, address: auth.address, loading: authLoading || auth.loading, error: authError }, isLoggingIn, syncTimedOut }} />
                        )}
                    </main>

                    {/* ── Footer ───────────────────────────────── */}
                    <footer className="k-footer">
                        <div className="k-footer-links">
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
                                    className="k-footer-social"
                                >
                                    {icon}
                                </a>
                            ))}
                        </div>
                        <p className="k-footer-copy">
                            memba v2 • built by samourai coop
                        </p>
                        <p className="k-footer-disclaimer">
                            ⚠️ Alpha — experimental open-source software for the gno.land ecosystem.
                            Unaudited, under active development. Use at your own risk.{" "}
                            <a href="https://github.com/sponsors/samouraiworld" target="_blank" rel="noopener noreferrer">
                                Tips & sponsorships
                            </a>{" "}welcome.
                        </p>
                    </footer>
                </div>

                {/* ── Mobile Tab Bar ────────────────────────────────── */}
                <MobileTabBar
                    connected={adena.connected}
                    address={auth.address || adena.address}
                    network={network}
                />

                {/* ── Command Palette (Cmd+K) ─────────────────────── */}
                <CommandPalette />

                {/* ── Jitsi PiP Overlay (v2.11 — persists across routes) ── */}
                <JitsiPiPOverlay />

                {/* ── What's New Toast (v2.14 — shown once per version to returning users) ── */}
                <WhatsNewToast />

                {/* ── Network switch success toast ── */}
                {walletSwitchMsg && (
                    <div
                        role="status"
                        aria-live="polite"
                        className="k-toast-network"
                    >
                        {walletSwitchMsg}
                    </div>
                )}
            </div>
        </JitsiProvider>
        </OrgProvider>
    )
}
