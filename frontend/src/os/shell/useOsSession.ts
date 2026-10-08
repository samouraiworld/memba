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
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAdena, type ConnectFailure } from "../../hooks/useAdena"
import { useAuth } from "../../hooks/useAuth"
import { useBalance } from "../../hooks/useBalance"
import { NETWORKS } from "../../lib/config"
import { FALLBACK_GAS_PRICE, networkGasPriceFresh, type GasPrice } from "../../lib/grc20"
import { ACTIVATION_REQUIRED_CODE } from "../../lib/loginErrors"
import { completeQuest, setQuestWalletAddress, syncQuestsToBackend } from "../../lib/quests"
import { activeOsNetwork } from "./network"
import type { LayoutContext } from "../../types/layout"
import { signInWithWallet } from "./walletLogin"
import { accountMark, accountMarkAfterBlocks } from "../sign/accountMark"
import { executeSignature } from "../sign/signer"
import { ACTIVATION_NOT_SEEN, ACTIVATION_SEND_UGNOT, activationCosts, activationOnChain } from "../../lib/activation"
import { chainPublicKey } from "../../lib/account"
import { activationRequest } from "./activation"
import type { EvmConnect } from "../evm/useEvmSession"
import { ADENA_CLOSED_MESSAGE, ADENA_NO_ANSWER_MESSAGE, type PromptWatch } from "../../lib/adenaCall"

export type ConnectStage = "pick" | "missing" | "waking" | "approve" | "login" | "loginwait" | "activate" | "activatewait" | "activatesent"

/** Why the last connect or sign-in failed, when the modal has more to offer than the message (a reload). */
export type ConnectErrorKind = "no-answer" | "closed"

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
    const [errorKind, setErrorKind] = useState<ConnectErrorKind | null>(null)
    // Adena's window has been open a while (it may be out of sight) / never seemed to open.
    const [slow, setSlow] = useState(false)
    const [noPopup, setNoPopup] = useState(false)
    const [note, setNote] = useState<string | null>(null)
    const [resumeTimedOut, setResumeTimedOut] = useState(false)
    // Bumped by cancel/disconnect: a step still awaiting Adena then stands down.
    const epoch = useRef(0)
    // Stops, with the epoch, what a step still waiting on Adena would do next: a pending
    // connect (no AddEstablish, no saved session) or an activation's account watch.
    const watch = useRef<AbortController | null>(null)
    useEffect(() => {
        const current = watch
        return () => current.current?.abort()
    }, [])
    const connectOpener = useRef<HTMLElement | null>(null)
    const { onSignedIn } = opts

    const restoreConnectFocus = useCallback(() => {
        const opener = connectOpener.current
        connectOpener.current = null
        requestAnimationFrame(() => {
            const fallback = document.querySelector<HTMLElement>('button[aria-label="Memba menu"], .os-ph-dock button')
            if (opener?.isConnected) opener.focus({ preventScroll: true })
            else fallback?.focus({ preventScroll: true })
        })
    }, [])

    const member = adena.connected && auth.isAuthenticated && !!adena.address && auth.address === adena.address
    const resuming = adena.reconnecting && !resumeTimedOut
    const status: SessionStatus = member ? "member" : resuming ? "resuming" : "guest"
    // Activated in this page: the chain shows its key, while the wallet's copy, read at connect, has none.
    const [activatedAddress, setActivatedAddress] = useState("")
    // Untransacted wallet in an address-only session: activation isn't optional (same rule as Layout).
    const activationForced = member && !adena.pubkeyJSON && activatedAddress !== adena.address
    const { rawUgnot, loading: balanceLoading, balance, error: balanceError, refetch: refreshBalance } = useBalance(adena.connected ? adena.address : null)
    const balanceKnown = !balanceLoading && rawUgnot !== undefined
    const spendableUgnot = balanceLoading ? undefined : rawUgnot
    const displayedBalance = balanceLoading ? "— GNOT" : balance
    // Activation is priced at the network's rate when its step shows and re-checked before Adena opens.
    // That is the fee Memba asks for; Adena may set its own from its gas estimate.
    const [activationPrice, setActivationPrice] = useState<GasPrice | null>(null)
    const activationCost = activationPrice ? activationCosts(activationPrice) : null
    const pricingActivation = stage === "activate" || activationForced
    useEffect(() => {
        if (!pricingActivation || activationPrice) return
        let alive = true
        // Read from the chain each time the step opens (not the shared cache): after a rise or a put-off, the figure is current.
        networkGasPriceFresh().then((p) => { if (alive) setActivationPrice(p) }, () => { if (alive) setActivationPrice(FALLBACK_GAS_PRICE) })
        return () => { alive = false }
    }, [pricingActivation, activationPrice])

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
            watch.current?.abort()
            latest.current.auth.logout()
            latest.current.adena.disconnect()
            setStage(null)
        })
    }, [adena.installed])

    const go = useCallback((next: ConnectStage | null, err: string | null = null, kind: ConnectErrorKind | null = null) => {
        setStage(next)
        setError(err)
        setErrorKind(err ? kind : null)
        setSlow(false)
        setNoPopup(false)
    }, [])

    /** Warm Adena up while the person decides (hover, focus, the wallet list): a read, never a window. */
    const { wake: wakeAdena } = adena
    const wake = useCallback(() => {
        if (!adena.connected && adenaPresent()) void wakeAdena()
    }, [adena.connected, wakeAdena])

    const openConnect = useCallback(() => {
        if (member) return
        connectOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setNote(null)
        wake()
        go(adena.connected ? "login" : "pick")
    }, [member, adena.connected, go, wake])

    /** What a step waiting on Adena's window hears, while it is still the current step. */
    const watchFor = useCallback((my: number, onSent?: () => void): PromptWatch => ({
        onSent: () => { if (epoch.current === my) onSent?.() },
        onSlow: () => { if (epoch.current === my) setSlow(true) },
        onNoPopup: () => { if (epoch.current === my) setNoPopup(true) },
    }), [])

    const approve = useCallback(async () => {
        const my = ++epoch.current
        watch.current?.abort()
        const stop = new AbortController()
        watch.current = stop
        go("waking")
        let failure = null as { kind: ConnectFailure; message: string } | null
        const ok = await adena.connect({
            signal: stop.signal,
            watch: {
                // "Approve in Adena" only once Adena was actually asked.
                ...watchFor(my, () => go("approve")),
                onFailure: (kind, message) => { failure = { kind, message } },
            },
        })
        if (epoch.current !== my) return
        if (ok) { go("login"); return }
        if (failure?.kind === "no-answer" || failure?.kind === "closed") go("pick", failure.message, failure.kind)
        else go("pick", "Adena didn't connect. Approve Memba in the Adena window, then try again.")
    }, [adena, go, watchFor])

    const chooseAdena = useCallback(() => {
        if (!adena.installed && !adenaPresent()) { go("missing"); return }
        wake()
        void approve()
    }, [adena.installed, approve, go, wake])

    // The silent reconnect can finish while the person is still in the connect flow: a
    // member is done (the lock screen opens too), a connected wallet goes on to sign in.
    useEffect(() => {
        if (!stage || !adena.connected || !adena.address) return
        if (member && (stage === "pick" || stage === "waking" || stage === "approve" || stage === "login")) {
            epoch.current++
            // eslint-disable-next-line react-hooks/set-state-in-effect -- reacts to the wallet finishing its silent reconnect
            go(null)
            restoreConnectFocus()
            onSignedIn?.(adena.address)
        } else if (!member && (stage === "pick" || stage === "waking" || stage === "approve")) {
            epoch.current++
            go("login")
        }
    }, [stage, member, adena.connected, adena.address, go, restoreConnectFocus, onSignedIn])

    const recheck = useCallback(() => {
        if (adenaPresent()) void approve()
        else go("missing", "Adena still isn't detected. If you just installed it, reload this page.")
    }, [approve, go])

    const signIn = useCallback(async () => {
        const my = ++epoch.current
        go("loginwait")
        try {
            const token = await signInWithWallet(adena, auth, network.chainId, { watch: watchFor(my) })
            if (epoch.current !== my) return
            go(null)
            restoreConnectFocus()
            setNote(null)
            completeQuest("connect-wallet", token)
            syncQuestsToBackend(token).catch(() => { /* offline-first */ })
            onSignedIn?.(token.userAddress || adena.address)
        } catch (err) {
            if (epoch.current !== my) return
            const msg = err instanceof Error ? err.message : "Sign-in failed"
            if (msg.includes(ACTIVATION_REQUIRED_CODE)) go("activate")
            else go("login", msg, msg === ADENA_NO_ANSWER_MESSAGE ? "no-answer" : msg === ADENA_CLOSED_MESSAGE ? "closed" : null)
        }
    }, [adena, auth, network.chainId, go, onSignedIn, restoreConnectFocus, watchFor])

    const activate = useCallback(async () => {
        if (!activationPrice) return
        const my = ++epoch.current
        watch.current?.abort()
        const stop = new AbortController()
        watch.current = stop
        // Leaves the activate step at once: a second click can't send a second transaction.
        go("activatewait")
        const address = adena.address
        // An address the chain already shows a key for is active, so nothing is sent: a node that lagged at
        // sign-in, or an activation that landed after Memba stopped waiting. A failed read sends, as before.
        const active = await chainPublicKey(address).then(Boolean, () => false)
        if (epoch.current !== my) return
        if (!active) {
            // 1 ugnot to the address itself: any first transaction registers the key. Signed through the OS
            // path, so no classic confirmation opens: the step the person just read is the review.
            const req = activationRequest(address, activationPrice)
            const res = await executeSignature(req, undefined, req.prepare(undefined).msgs, () => {}, () => epoch.current === my, {
                // A "rejected" reply is confirmed against the account, so a plain cancel reads as one.
                before: () => accountMark(address),
                after: () => accountMarkAfterBlocks(address),
                stop: stop.signal,
            })
            if (epoch.current !== my) return
            if (res.outcome !== "sent") {
                // The price is read again for the next attempt: it may be what refused this one.
                setActivationPrice(null)
                go("activate", res.error)
                return
            }
            // Adena answered at broadcast: the login signature, and the session, need the key on chain first.
            go("activatesent")
            const visible = await activationOnChain(address, stop.signal)
            if (epoch.current !== my) return
            if (!visible) {
                go(activationForced ? "activate" : "login", `${ACTIVATION_NOT_SEEN} ${activationForced
                    ? "Select Activate in Adena again in a few seconds: Memba checks the network first, and sends nothing if it already shows your address as active."
                    : "Wait a few seconds, then sign in."}`)
                return
            }
        }
        if (activationForced) {
            setActivatedAddress(address)
            go(null)
            restoreConnectFocus()
            return
        }
        setNote("Your address is active. Sign the login message to finish.")
        go("login")
    }, [adena.address, activationForced, activationPrice, go, restoreConnectFocus])

    const cancel = useCallback(() => {
        epoch.current++
        watch.current?.abort()
        setActivationPrice(null)
        go(null)
        restoreConnectFocus()
        setNote(null)
    }, [go, restoreConnectFocus])

    /** Ask Adena to switch to Memba's network (adding it first if Adena doesn't know it). */
    const switchWallet = useCallback(
        () => adena.switchWalletNetwork(network.chainId, network.label, NETWORKS[network.key]?.rpcUrl),
        [adena, network.chainId, network.label, network.key],
    )

    const disconnect = useCallback(() => {
        epoch.current++
        watch.current?.abort()
        adena.disconnect()
        auth.logout()
        go(null)
        setNote(null)
    }, [adena, auth, go])

    // What Layout hands classic pages, for the pages Memba OS shows in windows. Connecting
    // and signing out go through the OS flow, not the page's own wallet calls.
    const layout = useMemo<LayoutContext>(() => ({
        adena: { ...adena, connect: async () => { openConnect(); return false }, disconnect },
        balance: displayedBalance,
        rawUgnot: spendableUgnot,
        auth: { token: auth.token, isAuthenticated: auth.isAuthenticated, address: auth.address, loading: auth.loading, error: auth.error },
        isLoggingIn: resuming || stage === "loginwait",
        syncTimedOut: resumeTimedOut,
    }), [adena, openConnect, disconnect, displayedBalance, spendableUgnot, auth.token, auth.isAuthenticated, auth.address, auth.loading, auth.error, resuming, stage, resumeTimedOut])

    return {
        status,
        layout,
        address: member ? adena.address : "",
        walletAddress: adena.address,
        /** The chain Adena is on ("" before it reports one). */
        walletChainId: adena.chainId,
        network,
        balanceError,
        refreshBalance,
        stage: activationForced && stage !== "activatewait" && stage !== "activatesent" ? ("activate" as const) : stage,
        activationForced,
        /** What activation costs at the network's price, once read. */
        activationCost,
        /** The price could not be read: the fee shown is an estimate, re-read before Adena opens. */
        activationPriceEstimated: activationPrice === FALLBACK_GAS_PRICE,
        /** Known to be short of the fee: activation can't go through yet. */
        noFunds: balanceKnown && activationCost !== null && rawUgnot! < BigInt(activationCost.feeUgnot) + ACTIVATION_SEND_UGNOT,
        balanceUnknown: !balanceKnown,
        error,
        /** Why `error` happened, when the modal offers more than the message. */
        errorKind,
        /** Adena's window has been open 3 s: it may be behind this one or on another screen. */
        slow,
        /** 8 s and this page never lost focus: Adena's window most likely never opened. */
        noPopup,
        note,
        openConnect,
        wake,
        chooseAdena,
        recheck,
        signIn,
        activate,
        cancel,
        disconnect,
        switchWallet,
    }
}

/** The session the shell runs on. On an EVM network it comes from os/evm/useEvmSession.ts with `evm` set. */
export type OsSession = ReturnType<typeof useOsSession> & { evm?: EvmConnect }
