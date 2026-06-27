import { useEffect, useRef, useCallback, useState, useMemo } from "react"
import { Outlet } from "react-router-dom"
import { XLogo, InstagramLogo, YoutubeLogo, GithubLogo, LinkedinLogo, TelegramLogo, EnvelopeSimple } from "@phosphor-icons/react"
import { useAdena } from "../../hooks/useAdena"
import { useBalance } from "../../hooks/useBalance"
import { useAuth } from "../../hooks/useAuth"
import { useNetwork } from "../../hooks/useNetwork"
import { useUnvotedCount } from "../../hooks/useUnvotedCount"
import { useNotifications } from "../../hooks/useNotifications"
import { getSavedDAOs } from "../../lib/daoSlug"
import { APP_VERSION } from "../../lib/config"
import { buildTokenRequestInfo } from "../../lib/loginChallenge"
import { syncQuestsToBackend, completeQuest, setQuestWalletAddress, checkAndSetLegacyEligibility } from "../../lib/quests"
import { DesktopShell } from "./DesktopShell"
import { MobileShell } from "./MobileShell"
import { TopBar } from "./TopBar"
import { MobileTabBar } from "./MobileTabBar"
import { useIsMobile } from "../../hooks/useIsMobile"
import { CommandPalette } from "../ui/CommandPalette"
import { ConnectingLoader } from "../ui/ConnectingLoader"
import { JitsiProvider } from "../../contexts/JitsiContext"
import { OrgProvider } from "../../contexts/OrgContext"
import { JitsiPiPOverlay } from "../ui/JitsiPiPOverlay"
import { WhatsNewToast } from "../ui/WhatsNewToast"
import { QuestToast } from "../quests/QuestToast"
import { getQuestById } from "../../lib/gnobuilders"
import { setupKonamiDetector, trackDailyLogin } from "../../lib/questVerifier"
import { NetworkStatusToast } from "../ui/NetworkStatusToast"
import { ChainHaltedBanner } from "../ui/ChainHaltedBanner"
import { RealmsNotDeployedBanner } from "../ui/RealmsNotDeployedBanner"
import { AddressOnlyLoginBanner } from "../ui/AddressOnlyLoginBanner"
import { networkHasRealms, GNO_FAUCET_URL } from "../../lib/config"
import { OnboardingWizard } from "../ui/OnboardingWizard"
import { hasSeenWizard } from "../../lib/onboarding"


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
    const isMobile = useIsMobile()
    const { compactBalance, balance, rawUgnot } = useBalance(adena.connected ? adena.address : null)
    const network = useNetwork()
    const [authLoading, setAuthLoading] = useState(false)
    const [authError, setAuthError] = useState<string | null>(null)
    const [walletSwitchMsg, setWalletSwitchMsg] = useState<string | null>(null)
    const [questToast, setQuestToast] = useState<{ title: string; icon: string; xp: number; rankUp?: string } | null>(null)
    const dismissQuestToast = useCallback(() => setQuestToast(null), [])
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
            // 1. Get a server challenge. Bound to our pubkey when the chain already
            // knows it (AUTH-01 defense-in-depth); unbound otherwise — proof then comes
            // from the signature below. Also binds the active chain so it round-trips
            // (AUTH-CHAINID-01).
            const challenge = await auth.getChallenge(adena.pubkeyJSON || undefined, network.chainId)
            if (!challenge) throw new Error("Failed to get challenge")

            // 2. Sign the tx-shaped login proof via Adena's SignMultisigTransaction
            // (Adena has no ADR-036). That popup resolves the signature back to the page
            // and signs the doc as-is (no gas simulation), so it works on test12's
            // zero-fee chain. The signature proves key ownership; Adena's response carries
            // the signer's pubkey. Lockout-safe: if signing is declined/unavailable, fall
            // back to the unsigned flow gated by MEMBA_ALLOW_UNSIGNED_AUTH using the chain
            // pubkey. (Untransacted wallets can't sign — Adena requires an on-chain pubkey
            // — so they fall through to the guidance error below until they transact once.)
            const nonceB64 = bytesToBase64(challenge.nonce)
            const signed = await adena.signLoginChallenge(network.chainId, nonceB64)
            let signature = ""
            let pubkey = adena.pubkeyJSON || ""
            if (signed) {
                signature = signed.signature
                if (signed.pubKey) pubkey = signed.pubKey // authoritative (from sign response)
            } else {
                console.warn("[Memba] login signature unavailable (declined/unsupported) — unsigned fallback")
            }

            // No pubkey: an untransacted wallet — Adena (#800) won't sign for it or
            // reveal its pubkey. Fall through to ADDRESS-ONLY login so ANY wallet can
            // sign in (the server gates this behind MEMBA_ALLOW_UNSIGNED_AUTH; on a
            // chain where signed auth is enforced it returns a clear "activate your
            // wallet" error). Only hard-fail if the wallet gave us no address at all.
            if (!pubkey && !adena.address) {
                throw new Error("Wallet address unavailable — reconnect your wallet to sign in.")
            }

            // 3. Build TokenRequestInfo (protojson). The challenge MUST be echoed with
            // all server-signed fields — including chainId — or ValidateChallenge fails.
            // Transacted wallet → pubkey (ownership proof); untransacted → address-only.
            const info = buildTokenRequestInfo({
                nonceB64,
                expiration: challenge.expiration,
                serverSignatureB64: bytesToBase64(challenge.serverSignature),
                boundPubkeyHash: challenge.boundPubkeyHash || "",
                chainId: challenge.chainId || network.chainId,
                ...(pubkey ? { userPubkeyJson: pubkey } : { userAddress: adena.address }),
            })
            const infoJson = JSON.stringify(info)

            // 4. Exchange for auth token
            const token = await auth.getToken(infoJson, signature)
            if (!token) throw new Error("Authentication failed")

            // 5. Quest integration: sync localStorage quests to backend + mark connect-wallet
            completeQuest("connect-wallet", token)
            syncQuestsToBackend(token).catch(() => { /* offline-first */ })
        } catch (err) {
            // Keep the wallet CONNECTED on login failure — a transient backend
            // outage (e.g. getChallenge 5xx) must not force-disconnect the user out
            // of read-only browsing. Surface the error + a Retry action (retryLogin);
            // reserve disconnect() for explicit logout and the changedAccount handler.
            console.error("[Memba] Login failed:", err)
            setAuthError(err instanceof Error ? err.message : "Login failed")
        } finally {
            setAuthLoading(false)
        }
    }, [adena, auth, network.chainId])

    // H-06: Set wallet address for per-wallet quest isolation
    useEffect(() => {
        if (adena.connected && adena.address) {
            setQuestWalletAddress(adena.address)
            // v4.0: Check if user is grandfathered for old candidature threshold
            checkAndSetLegacyEligibility()
            // GnoBuilders: Track daily login for streak quest
            trackDailyLogin(adena.address)
        } else if (!adena.connected && !adena.reconnecting) {
            setQuestWalletAddress(null)
        }
    }, [adena.connected, adena.address, adena.reconnecting])

    // GnoBuilders: Konami code easter egg detector. The toast is surfaced by
    // the general quest-completed listener below (completeQuest dispatches it).
    useEffect(() => {
        const cleanup = setupKonamiDetector(() => {
            completeQuest("easter-egg-konami", auth.token ?? undefined)
        })
        return cleanup
    }, [auth.token])

    // GnoBuilders: surface a completion toast for ANY quest completion. This is
    // the single bridge that gives feedback for every completion — previously
    // only the Konami easter egg ever toasted, so most progress was silent.
    useEffect(() => {
        const onQuestComplete = (e: Event) => {
            const questId = (e as CustomEvent<{ questId: string }>).detail?.questId
            if (!questId) return
            const quest = getQuestById(questId)
            if (quest) setQuestToast({ title: quest.title, icon: quest.icon, xp: quest.xp })
        }
        window.addEventListener("quest-completed", onQuestComplete)
        return () => window.removeEventListener("quest-completed", onQuestComplete)
    }, [])

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

    // Retry login after a failure WITHOUT reconnecting the wallet: clear the error,
    // reopen the one-shot gate, and re-run. An explicit user action, so this can't
    // auto-loop the way resetting the gate inside the catch would.
    const retryLogin = useCallback(() => {
        setAuthError(null)
        loginAttemptedRef.current = false
        performLogin()
    }, [performLogin])

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

    // ── Onboarding wizard: show once per wallet on first login ──
    const [showWizard, setShowWizard] = useState(false)
    useEffect(() => {
        if (auth.isAuthenticated && auth.address && !isLoggingIn) {
            if (!hasSeenWizard(auth.address)) {
                setShowWizard(true)
            }
        }
    }, [auth.isAuthenticated, auth.address, isLoggingIn])

    // Multi-DAO notification polling: poll all saved DAOs
    const savedDaoPaths = useMemo(
        () => adena.connected ? getSavedDAOs().map(d => d.realmPath) : [],
        // Re-compute when auth state changes (user may save new DAOs)
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [adena.connected, auth.isAuthenticated],
    )
    const notifs = useNotifications(savedDaoPaths, adena.connected ? adena.address : null)

    // The auth slice handed to routes (via the Outlet context) and to the mobile
    // tab bar's Act FAB (for live pending-action badges). One source so the two
    // can't drift.
    const layoutAuth = {
        token: auth.token,
        isAuthenticated: auth.isAuthenticated,
        address: auth.address,
        loading: authLoading || auth.loading,
        error: authError,
    }

    // The main-column content (top bar, banners, routed page, footer) is shared
    // by both shells. Desktop wraps it alongside the Sidebar; mobile renders it
    // alone. Keeping it here (not duplicated in each shell) guarantees the two
    // shells stay in lockstep.
    const mainColumnContent = (
        <>
            <TopBar
                adena={adena}
                auth={auth}
                compactBalance={compactBalance}
                network={network}
                isLoggingIn={isLoggingIn}
                authError={authError}
                onDisconnect={handleDisconnect}
                onClearError={() => setAuthError(null)}
                onRetry={retryLogin}
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

            {/* ── C-02: Chain Halted Banner ── */}
            <ChainHaltedBanner
                networkKey={network.networkKey}
                onSwitchNetwork={network.switchNetwork}
            />

            {/* ── test13 cutover: Memba realms not yet deployed on this network ── */}
            <RealmsNotDeployedBanner
                deployed={networkHasRealms(network.networkKey)}
                networkLabel={network.label}
            />

            {/* ── Address-only session: nudge to upgrade to secure signed login ── */}
            <AddressOnlyLoginBanner
                show={adena.connected && auth.isAuthenticated && !adena.pubkeyJSON}
                faucetUrl={GNO_FAUCET_URL}
            />

            {/* ── Main ─────────────────────────────────────── */}
            <main id="main-content" className="k-main">
                {/* B8: Universal guard — show loader while wallet is syncing */}
                {isLoggingIn ? (
                    <ConnectingLoader />
                ) : (
                    <Outlet context={{ adena, balance, rawUgnot, auth: layoutAuth, isLoggingIn, syncTimedOut }} />
                )}
            </main>

            {/* ── Footer ───────────────────────────────── */}
            <footer className="k-footer">
                <div className="k-footer-links">
                    {[
                        { href: "https://x.com/samouraicoop", label: "X", icon: <XLogo size={16} weight="fill" /> },
                        { href: "https://instagram.com/samourai.tv", label: "Instagram", icon: <InstagramLogo size={16} weight="fill" /> },
                        { href: "https://samourai.tv/", label: "YouTube", icon: <YoutubeLogo size={16} weight="fill" /> },
                        { href: "https://github.com/samouraiworld/memba", label: "GitHub", icon: <GithubLogo size={16} weight="fill" /> },
                        { href: "https://www.linkedin.com/company/samouraicoop/", label: "LinkedIn", icon: <LinkedinLogo size={16} weight="fill" /> },
                        { href: "https://t.me/samouraicoop", label: "Telegram", icon: <TelegramLogo size={16} weight="fill" /> },
                        { href: "mailto:support@samourai.coop", label: "Email", icon: <EnvelopeSimple size={16} weight="fill" /> },
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
                    memba v{APP_VERSION} • built by samourai coop
                </p>
                <p className="k-footer-disclaimer">
                    ⚠️ Alpha — experimental open-source software for the gno.land ecosystem.
                    Unaudited, under active development. Use at your own risk.{" "}
                    <a href="https://github.com/sponsors/samouraiworld" target="_blank" rel="noopener noreferrer">
                        Tips & sponsorships
                    </a>{" "}welcome.
                </p>
            </footer>
        </>
    )

    return (
        <OrgProvider>
        <JitsiProvider>
            <div className={`k-app-layout${sidebarCollapsed ? " k-sidebar-collapsed" : ""}`}>
                {/* Skip to content (accessibility — focus-only) */}
                <a href="#main-content" className="k-skip-to-content">
                    Skip to content
                </a>

                {/* ── Shell: desktop renders the Sidebar + main column; mobile
                    renders the main column alone (no desktop chrome). Both wrap
                    the same `mainColumnContent`, so the desktop tree is byte-
                    identical to before the split. ── */}
                {isMobile ? (
                    <MobileShell>{mainColumnContent}</MobileShell>
                ) : (
                    <DesktopShell
                        connected={adena.connected}
                        address={auth.address || adena.address}
                        unvotedCount={unvotedCount}
                        notifUnreadCount={notifs.unreadCount}
                        collapsed={sidebarCollapsed}
                        onToggleCollapse={handleToggleCollapse}
                    >
                        {mainColumnContent}
                    </DesktopShell>
                )}

                {/* ── Mobile Tab Bar ────────────────────────────────── */}
                <MobileTabBar
                    connected={adena.connected}
                    address={auth.address || adena.address}
                    auth={layoutAuth}
                    network={network}
                />

                {/* ── Command Palette (Cmd+K) ─────────────────────── */}
                <CommandPalette />

                {/* ── Jitsi PiP Overlay (v2.11 — persists across routes) ── */}
                <JitsiPiPOverlay />

                {/* ── What's New Toast (v2.14 — shown once per version to returning users) ── */}
                <WhatsNewToast />
                <NetworkStatusToast />

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

                {/* ── GnoBuilders quest completion toast ── */}
                {questToast && (
                    <QuestToast
                        questTitle={questToast.title}
                        questIcon={questToast.icon}
                        xpEarned={questToast.xp}
                        rankUp={questToast.rankUp}
                        onDismiss={dismissQuestToast}
                    />
                )}

                {/* ── Onboarding wizard (first-time users) ── */}
                {showWizard && auth.address && (
                    <OnboardingWizard
                        address={auth.address}
                        onClose={() => setShowWizard(false)}
                    />
                )}
            </div>
        </JitsiProvider>
        </OrgProvider>
    )
}
