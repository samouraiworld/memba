/**
 * Wallet session for Memba OS: the connect flow from the mockup (pick →
 * not installed / approve in Adena → sign the login message → activate)
 * on the existing wallet and auth hooks. Memba OS runs outside Layout, so the
 * session rules Layout applies are mirrored here: a token without its wallet
 * is dropped, a token for another address is dropped, an account switch in
 * Adena signs out.
 *
 * @module os/shell/useOsSession
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useAdena } from "../../hooks/useAdena"
import { useAuth } from "../../hooks/useAuth"
import { useBalance } from "../../hooks/useBalance"
import { ACTIVATION_PROFILE_REALM, NETWORKS } from "../../lib/config"
import { doContractBroadcast } from "../../lib/grc20"
import { ACTIVATION_REQUIRED_CODE } from "../../lib/loginErrors"
import { completeQuest, setQuestWalletAddress, syncQuestsToBackend } from "../../lib/quests"
import { activeOsNetwork } from "./network"
import { signInWithWallet } from "./walletLogin"

export type ConnectStage = "pick" | "missing" | "approve" | "login" | "loginwait" | "activate" | "activatewait"

export type SessionStatus = "resuming" | "guest" | "member"

/** How long a silent reconnect may keep the desktop in "resuming" (Layout uses the same 10 s). */
const RESUME_TIMEOUT_MS = 10_000

function adenaPresent(): boolean {
    return typeof window !== "undefined" && !!(window as unknown as { adena?: unknown }).adena
}

export function useOsSession(opts: { onSignedIn?: (address: string) => void } = {}) {
    const adena = useAdena()
    const auth = useAuth()
    const network = activeOsNetwork()
    const [stage, setStage] = useState<ConnectStage | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [note, setNote] = useState<string | null>(null)
    const [resumeTimedOut, setResumeTimedOut] = useState(false)
    // Bumped by cancel/disconnect: a step still awaiting Adena then stands down.
    const epoch = useRef(0)
    const { onSignedIn } = opts

    const member = adena.connected && auth.isAuthenticated && !!adena.address && auth.address === adena.address
    const resuming = adena.reconnecting && !resumeTimedOut
    const status: SessionStatus = member ? "member" : resuming ? "resuming" : "guest"
    // Untransacted wallet in an address-only session: activation isn't optional (same rule as Layout).
    const activationForced = member && !adena.pubkeyJSON
    const { rawUgnot, loading: balanceLoading, balance } = useBalance(adena.connected ? adena.address : null)
    const balanceKnown = !balanceLoading && !balance.startsWith("—")

    useEffect(() => {
        if (!adena.reconnecting) return
        const t = setTimeout(() => setResumeTimedOut(true), RESUME_TIMEOUT_MS)
        return () => clearTimeout(t)
    }, [adena.reconnecting])

    // Layout's session rules, mirrored.
    useEffect(() => {
        if (!adena.connected && auth.isAuthenticated && !adena.reconnecting) auth.logout()
    }, [adena.connected, adena.reconnecting, auth])
    useEffect(() => {
        if (adena.connected && auth.isAuthenticated && adena.address && auth.address && adena.address !== auth.address) auth.logout()
    }, [adena.connected, adena.address, auth])
    useEffect(() => {
        if (adena.connected && adena.address) setQuestWalletAddress(adena.address)
        else if (!adena.connected && !adena.reconnecting) setQuestWalletAddress(null)
    }, [adena.connected, adena.address, adena.reconnecting])
    // Adena.On has no unsubscribe, so the account listener is registered once and
    // reads the latest hooks through a ref.
    const latest = useRef({ adena, auth })
    useEffect(() => { latest.current = { adena, auth } })
    const accountListener = useRef(false)
    useEffect(() => {
        if (accountListener.current) return
        const g = (window as unknown as { adena?: { On?: (e: string, cb: () => void) => unknown } }).adena
        if (!g || typeof g.On !== "function") return
        accountListener.current = true
        g.On("changedAccount", () => {
            epoch.current++
            latest.current.auth.logout()
            latest.current.adena.disconnect()
            setStage(null)
        })
    }, [adena.installed])

    const go = useCallback((next: ConnectStage | null, err: string | null = null) => {
        setStage(next)
        setError(err)
    }, [])

    const openConnect = useCallback(() => {
        if (member) return
        setNote(null)
        go(adena.connected ? "login" : "pick")
    }, [member, adena.connected, go])

    const approve = useCallback(async () => {
        const my = ++epoch.current
        go("approve")
        const ok = await adena.connect()
        if (epoch.current !== my) return
        if (ok) go("login")
        else go("pick", "Adena didn't connect. Approve Memba in the Adena window, then try again.")
    }, [adena, go])

    const chooseAdena = useCallback(() => {
        if (!adena.installed && !adenaPresent()) { go("missing"); return }
        void approve()
    }, [adena.installed, approve, go])

    const recheck = useCallback(() => {
        if (adenaPresent()) void approve()
        else go("missing", "Adena still isn't detected. If you just installed it, reload this page.")
    }, [approve, go])

    const signIn = useCallback(async () => {
        const my = ++epoch.current
        go("loginwait")
        try {
            const token = await signInWithWallet(adena, auth, network.chainId)
            if (epoch.current !== my) return
            go(null)
            setNote(null)
            completeQuest("connect-wallet", token)
            syncQuestsToBackend(token).catch(() => { /* offline-first */ })
            onSignedIn?.(token.userAddress || adena.address)
        } catch (err) {
            if (epoch.current !== my) return
            const msg = err instanceof Error ? err.message : "Sign-in failed"
            if (msg.includes(ACTIVATION_REQUIRED_CODE)) go("activate")
            else go("login", msg)
        }
    }, [adena, auth, network.chainId, go, onSignedIn])

    const activate = useCallback(async () => {
        const my = ++epoch.current
        go("activatewait")
        try {
            // The same transaction as ActivationModal: a MsgCall writing an empty
            // "Bio" on the caller's own profile. Any first transaction registers
            // the key; Adena refuses a bank send through DoContract.
            await doContractBroadcast(
                [{
                    type: "vm/MsgCall",
                    value: { caller: adena.address, send: "", pkg_path: ACTIVATION_PROFILE_REALM, func: "SetStringField", args: ["Bio", ""] },
                }],
                "Memba Network Activation",
            )
            if (epoch.current !== my) return
            if (activationForced) { window.location.reload(); return } // re-read the wallet with its key
            setNote("Your address is active. Sign the login message to finish.")
            go("login")
        } catch (err) {
            if (epoch.current !== my) return
            go("activate", err instanceof Error ? err.message : String(err))
        }
    }, [adena.address, activationForced, go])

    const cancel = useCallback(() => {
        epoch.current++
        go(null)
        setNote(null)
    }, [go])

    /** Ask Adena to switch to Memba's network (adding it first if Adena doesn't know it). */
    const switchWallet = useCallback(
        () => adena.switchWalletNetwork(network.chainId, network.label, NETWORKS[network.key]?.rpcUrl),
        [adena, network.chainId, network.label, network.key],
    )

    const disconnect = useCallback(() => {
        epoch.current++
        adena.disconnect()
        auth.logout()
        go(null)
        setNote(null)
    }, [adena, auth, go])

    return {
        status,
        address: member ? adena.address : "",
        walletAddress: adena.address,
        /** The chain Adena is on ("" before it reports one). */
        walletChainId: adena.chainId,
        network,
        stage: activationForced && stage !== "activatewait" ? ("activate" as const) : stage,
        activationForced,
        /** Known to be empty: activation can't pay its fee yet. */
        noFunds: balanceKnown && rawUgnot === 0n,
        error,
        note,
        openConnect,
        chooseAdena,
        recheck,
        signIn,
        activate,
        cancel,
        disconnect,
        switchWallet,
    }
}

export type OsSession = ReturnType<typeof useOsSession>
