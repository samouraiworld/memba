/**
 * Wallet session for Memba OS on an EVM network (Base), in the same shape as
 * the Gno one (os/shell/useOsSession.ts) so the shell runs unchanged. The
 * wallet comes from the lazy adapter's single store; nothing here imports an
 * EVM library, so a flag-off build drops this module with the code that uses it.
 *
 * Rules, mirrored from the Gno session: a token counts only for the connected
 * account on this chain (os/evm/sessionRules.ts), so a disconnect or an account
 * switch in the wallet signs out. Signing in (SIWE) arrives with the backend's
 * challenge and token RPCs; until then a connected wallet is a guest.
 *
 * @module os/evm/useEvmSession
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { useAuth } from "../../hooks/useAuth"
import { loadEvmAdapter } from "../../lib/chain/evm/load"
import type { EvmWallet, EvmWalletOption, EvmWalletSnapshot } from "../../lib/chain/evm/wallet"
import type { LayoutContext } from "../../types/layout"
import { activeOsNetwork } from "../shell/network"
import type { ConnectStage, OsSession, SessionStatus } from "../shell/useOsSession"
import { caip2, isEvmToken, tokenFits } from "./sessionRules"

/** What the EVM connect modal needs beyond the shared session. */
export interface EvmConnect {
    /** The wallets found in this browser (ERC-6963 announcements, or window.ethereum). */
    wallets: readonly EvmWalletOption[]
    /** Connect the wallet the person picked. */
    choose: (uid: string) => void
    /** The wallet is connected on another chain than Memba's network. */
    wrongChain: boolean
}

/** How long a silent reconnect may keep the desktop in "resuming" (the Gno session uses the same 10 s). */
const RESUME_TIMEOUT_MS = 10_000

const NO_WALLET: EvmWalletSnapshot = { status: "disconnected", address: "", chainId: null, wallets: [] }
const noSubscribe = () => () => {}
const noWalletSnapshot = () => NO_WALLET
const noop = () => {}

export function useEvmSession(opts: { onSignedIn?: (address: string) => void } = {}): OsSession {
    void opts // signed-in notice: wired with SIWE
    const auth = useAuth()
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

    // An EVM token for another account or chain, or with no wallet, is dropped; a gno.land token is not ours to touch.
    useEffect(() => {
        if (resuming || !isEvmToken(auth.token)) return
        if (!tokenFits(auth.token, chain, connected ? wallet.address : "")) auth.logout()
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
        if (isEvmToken(auth.token)) auth.logout()
        go(null)
    }, [store, auth, go])

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
        signIn: async () => {},
        activate: async () => {},
        cancel,
        disconnect,
        switchWallet,
        evm: { wallets: wallet.wallets, choose, wrongChain: connected && walletChainId !== network.chainId },
    }
}
