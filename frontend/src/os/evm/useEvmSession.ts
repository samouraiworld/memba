/**
 * Wallet session for Memba OS on an EVM network (Base), in the same shape as
 * the Gno one (os/shell/useOsSession.ts) so the shell runs unchanged. The
 * wallet comes from the lazy adapter's single store; nothing here imports an
 * EVM library, so a flag-off build drops this module with the code that uses it.
 *
 * Rules, mirrored from the Gno session: a token counts only for the connected
 * account on this chain (os/evm/sessionRules.ts), so a disconnect or an account
 * switch in the wallet signs out. The token lives under its own key
 * (os/evm/evmToken.ts): the gno.land session never sees it.
 *
 * Signing in is Sign-In with Ethereum: the backend frames the message
 * (GetSiweChallenge), checked here against this page before the wallet is asked;
 * the wallet signs it; the backend turns it into a session token (GetSiweToken),
 * kept only if it names the account and chain the wallet is still on.
 *
 * @module os/evm/useEvmSession
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { Code, ConnectError } from "@connectrpc/connect"
import { api } from "../../lib/api"
import { CHAIN_MISMATCH_CODE } from "../../lib/loginErrors"
import { loadEvmAdapter } from "../../lib/chain/evm/load"
import type { EvmWallet, EvmWalletOption, EvmWalletSnapshot } from "../../lib/chain/evm/wallet"
import type { Token } from "../../gen/memba/v1/memba_pb"
import type { LayoutContext } from "../../types/layout"
import { activeOsNetwork } from "../shell/network"
import type { ConnectStage, OsSession, SessionStatus } from "../shell/useOsSession"
import { useEvmToken } from "./evmToken"
import { caip2, tokenFits } from "./sessionRules"

/** What the EVM connect modal needs beyond the shared session. */
export interface EvmConnect {
    /** The wallets found in this browser (ERC-6963 announcements, or window.ethereum). */
    wallets: readonly EvmWalletOption[]
    /** Connect the wallet the person picked. */
    choose: (uid: string) => void
    /** The wallet is connected on another chain than Memba's network. */
    wrongChain: boolean
    /** The connected address in its EIP-55 form, for display ("" when none). */
    displayAddress: string
    /** The EVM session token (null as a guest). Read it through `evmAuthToken` (os/evm/evmToken.ts), which names the handler. */
    token: Token | null
}

/** How long a silent reconnect may keep the desktop in "resuming" (the Gno session uses the same 10 s). */
const RESUME_TIMEOUT_MS = 10_000

const NO_WALLET: EvmWalletSnapshot = { status: "disconnected", address: "", displayAddress: "", chainId: null, wallets: [] }
const noSubscribe = () => () => {}
const noWalletSnapshot = () => NO_WALLET
const noop = () => {}

/** The server's own Unimplemented, not an HTTP 404 that connect maps to the same code. */
const notOffered = (e: ConnectError) => e.code === Code.Unimplemented && !/^HTTP \d/.test(e.rawMessage)
/** Rate-limited (the limiter answers HTTP 429, read by connect as Unavailable) or busy. */
const busy = (e: ConnectError) => e.code === Code.Unavailable || e.code === Code.ResourceExhausted
const BUSY = "Too many sign-in attempts, or the server is busy. Wait a moment, then sign in again."

/** What to say when the server refused to start a sign-in (GetSiweChallenge). */
function challengeFailure(err: unknown, networkLabel: string): string {
    const e = ConnectError.from(err)
    if (notOffered(e)) return "This Memba server doesn't offer EVM sign-in yet."
    if (e.rawMessage.includes(CHAIN_MISMATCH_CODE)) return `This Memba server doesn't accept ${networkLabel} sign-ins yet.`
    if (e.code === Code.PermissionDenied) return "This site can't sign in to this Memba server."
    if (busy(e)) return BUSY
    return "Memba couldn't reach its sign-in service. Try again in a moment."
}

/** What to say when the server refused the signed message (GetSiweToken). */
function tokenFailure(err: unknown, networkLabel: string, signature: string): string {
    const e = ConnectError.from(err)
    // The chain refusal also rides PermissionDenied (with its code as the message): read it first.
    if (e.rawMessage.includes(CHAIN_MISMATCH_CODE)) return `This Memba server doesn't accept ${networkLabel} sign-ins yet.`
    // 65 bytes is an account key's signature: a longer one comes from a smart wallet (EIP-1271 / ERC-6492).
    // The server doesn't say whether it checks those at all, so neither does this message.
    if (e.code === Code.PermissionDenied && signature.length > 2 + 65 * 2) return "Memba couldn't verify this smart-wallet signature, or this server doesn't accept smart-wallet sign-in yet."
    if (e.code === Code.PermissionDenied) return "Memba couldn't verify this sign-in. Sign in again."
    if (notOffered(e)) return "This Memba server doesn't offer EVM sign-in yet."
    if (busy(e)) return BUSY
    return "Memba couldn't complete the sign-in. Try again in a moment."
}

/** The challenge names this page and this chain; anything else is not ours to sign. */
function challengeFitsPage(ch: { chainId: string; domain: string; uri: string }, chain: string): boolean {
    try {
        return ch.chainId === chain && ch.domain === window.location.host && new URL(ch.uri).origin === window.location.origin
    } catch {
        return false
    }
}

export function useEvmSession(opts: { onSignedIn?: (address: string) => void } = {}): OsSession {
    const { onSignedIn } = opts
    const auth = useEvmToken()
    const network = activeOsNetwork()
    const chain = caip2(network.chainId)
    const [store, setStore] = useState<EvmWallet | null>(null)
    const [restored, setRestored] = useState(false)
    const [resumeTimedOut, setResumeTimedOut] = useState(false)
    const [stage, setStage] = useState<ConnectStage | null>(null)
    const [error, setError] = useState<string | null>(null)
    // Bumped by cancel/disconnect: a step still awaiting the wallet then stands down.
    const epoch = useRef(0)

    useEffect(() => {
        let alive = true
        loadEvmAdapter().then(
            async ({ evmWallet }) => {
                if (!alive) return
                setStore(evmWallet)
                await evmWallet.reconnect()
                if (alive) setRestored(true)
            },
            () => { if (alive) setRestored(true) },
        )
        const t = setTimeout(() => { if (alive) setResumeTimedOut(true) }, RESUME_TIMEOUT_MS)
        return () => { alive = false; clearTimeout(t) }
    }, [])

    const wallet = useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.getSnapshot ?? noWalletSnapshot)
    const connected = wallet.status === "connected" && !!wallet.address
    const resuming = !restored && !resumeTimedOut
    const member = connected && tokenFits(auth.token, chain, wallet.address)
    const status: SessionStatus = member ? "member" : resuming ? "resuming" : "guest"

    // The token for another account or chain, or with no wallet, is dropped.
    useEffect(() => {
        if (resuming || !auth.token) return
        if (!tokenFits(auth.token, chain, connected ? wallet.address : "")) auth.clear()
    }, [resuming, auth, chain, connected, wallet.address])

    const go = useCallback((next: ConnectStage | null, err: string | null = null) => {
        setStage(next)
        setError(err)
    }, [setStage, setError])

    const openConnect = useCallback(() => {
        if (member) return
        go(connected ? "login" : "pick")
    }, [member, connected, go])

    const choose = useCallback((uid: string) => {
        if (!store) return
        const my = ++epoch.current
        go("approve")
        void store.connect(uid).then((res) => {
            if (epoch.current !== my) return
            if (res.ok) go("login")
            else go("pick", res.reason === "declined"
                ? "You declined the connection in your wallet. Pick a wallet when you're ready."
                : "The wallet didn't connect. Unlock it and try again.")
        })
    }, [store, go])

    const cancel = useCallback(() => {
        epoch.current++
        go(null)
    }, [go])

    const disconnect = useCallback(() => {
        epoch.current++
        void store?.disconnect()
        auth.clear()
        go(null)
    }, [store, auth, go])

    const wrongChain = connected && wallet.chainId !== Number(network.chainId)

    /** Sign-In with Ethereum: the server's challenge, the wallet's signature, the session token. Nothing is sent on-chain. */
    const signIn = useCallback(async () => {
        if (!store || !connected) return
        if (wrongChain) { go("login", `Switch your wallet to ${network.label} first.`); return }
        const my = ++epoch.current
        const address = wallet.address
        const display = wallet.displayAddress
        const chainId = Number(network.chainId)
        // Cancelled, or the wallet moved to another account or chain: this attempt stands down.
        const cancelled = () => epoch.current !== my
        const moved = () => { const now = store.getSnapshot(); return now.address !== address || now.chainId !== chainId }
        const stop = () => {
            if (cancelled()) return true
            if (!moved()) return false
            go("login", "Your wallet changed account or chain during the sign-in. Sign in again.")
            return true
        }
        go("loginwait")

        let adapter: Awaited<ReturnType<typeof loadEvmAdapter>>
        let challenge: Awaited<ReturnType<typeof api.getSiweChallenge>>["challenge"]
        try {
            [adapter, { challenge }] = await Promise.all([loadEvmAdapter(), api.getSiweChallenge({ chainId: chain })])
        } catch (err) {
            if (!cancelled()) go("login", challengeFailure(err, network.label))
            return
        }
        if (stop()) return
        if (!challenge || !challengeFitsPage(challenge, chain)) {
            go("login", "The server's sign-in request doesn't match this site. Nothing was signed.")
            return
        }
        let message: string
        try {
            message = adapter.buildSiweMessage(challenge, display)
        } catch {
            go("login", "The server's sign-in request is malformed. Nothing was signed.")
            return
        }

        const signed = await store.signMessage(message, display)
        if (stop()) return
        if (!signed.ok) {
            go("login", signed.reason === "declined"
                ? "You declined the sign-in message in your wallet. Sign in again when you're ready."
                : "Your wallet couldn't sign the message. Try again.")
            return
        }

        let token: Token | undefined
        try {
            // The signature goes as the wallet returned it: a smart wallet's EIP-1271 / ERC-6492 form included.
            token = (await api.getSiweToken({ challenge, message, signature: signed.signature })).authToken
        } catch (err) {
            if (!cancelled()) go("login", tokenFailure(err, network.label, signed.signature))
            return
        }
        if (stop()) return
        if (!token || !tokenFits(token, chain, address)) {
            go("login", "Memba's sign-in didn't match your wallet's account. Sign in again.")
            return
        }
        auth.adopt(token)
        go(null)
        onSignedIn?.(display)
    }, [store, connected, wrongChain, wallet.address, wallet.displayAddress, network.chainId, network.label, chain, auth, go, onSignedIn])

    /** Ask the wallet to switch to Memba's network. */
    const switchWallet = useCallback(async () => {
        if (!store) return false
        return (await store.switchChain(Number(network.chainId))).ok
    }, [store, network.chainId])

    // No classic page renders on an EVM network: Gno consumers of the layout see no wallet and no session.
    const layout = useMemo<LayoutContext>(() => ({
        adena: { connected: false, address: "", pubkeyJSON: "", chainId: "", installed: false, loading: false, connect: async () => { openConnect(); return false }, disconnect, signArbitrary: async () => null },
        balance: "",
        auth: { token: null, isAuthenticated: false, address: "", loading: false, error: null },
        isLoggingIn: resuming,
        syncTimedOut: resumeTimedOut,
    }), [openConnect, disconnect, resuming, resumeTimedOut])

    const walletChainId = wallet.chainId === null ? "" : String(wallet.chainId)
    return {
        status,
        layout,
        address: member ? wallet.address : "",
        walletAddress: wallet.address,
        walletChainId,
        network,
        balanceError: null,
        refreshBalance: async () => {},
        stage,
        // Activation is a gno.land step: EVM accounts need none.
        activationForced: false,
        activationCost: null,
        activationPriceEstimated: false,
        noFunds: false,
        balanceUnknown: true,
        error,
        note: null,
        openConnect,
        chooseAdena: noop,
        recheck: noop,
        signIn,
        activate: async () => {},
        cancel,
        disconnect,
        switchWallet,
        evm: { wallets: wallet.wallets, choose, wrongChain, displayAddress: wallet.displayAddress, token: member ? auth.token : null },
    }
}
