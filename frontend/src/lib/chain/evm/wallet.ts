/**
 * The EVM wallet as one external store (the single wallet source the shell
 * reads through useSyncExternalStore): its snapshot only changes when the
 * connection or the list of wallets does. Part of the lazy adapter chunk.
 *
 * Addresses are kept in their canonical stored form, lowercase `0x…`; EIP-55
 * casing is for display and input only.
 *
 * @module lib/chain/evm/wallet
 */
import { connect, disconnect, getConnection, reconnect, signMessage, switchChain, watchConnection, watchConnectors, type Config } from "@wagmi/core"

export interface EvmWalletOption {
    uid: string
    name: string
    /** Data URI the wallet announced (ERC-6963), when it gave one. */
    icon?: string
}

export interface EvmWalletSnapshot {
    status: "connected" | "connecting" | "reconnecting" | "disconnected"
    /** Lowercase `0x…`, or "" when no account is connected. */
    address: string
    /** The same address in its EIP-55 form, for display and messages only. */
    displayAddress: string
    /** The chain the wallet is on, or null when not connected. */
    chainId: number | null
    wallets: readonly EvmWalletOption[]
}

/** What a wallet request came to: done, refused by the person in the wallet, or failed otherwise. */
export type WalletOutcome = { ok: true } | { ok: false; reason: "declined" | "failed" }

/** EIP-1193 4001 (user rejected), wherever a wrapper put it. */
function declinedInWallet(err: unknown): boolean {
    for (let e: unknown = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
        if ((e as { code?: unknown }).code === 4001) return true
    }
    return false
}

async function outcome(run: () => Promise<unknown>): Promise<WalletOutcome> {
    try {
        await run()
        return { ok: true }
    } catch (err) {
        return { ok: false, reason: declinedInWallet(err) ? "declined" : "failed" }
    }
}

/**
 * The wallets to offer: each one this browser announced (ERC-6963), named and
 * drawn as it announced itself. The generic `window.ethereum` connector only
 * stands in when nothing announced itself and something is actually injected.
 */
function walletOptions(config: Config): EvmWalletOption[] {
    const announced = config.connectors.filter((k) => k.id !== "injected")
    if (announced.length > 0) return announced.map((k) => ({ uid: k.uid, name: k.name, ...(k.icon ? { icon: k.icon } : {}) }))
    const generic = config.connectors.find((k) => k.id === "injected")
    const injectedHere = typeof window !== "undefined" && !!(window as { ethereum?: unknown }).ethereum
    return generic && injectedHere ? [{ uid: generic.uid, name: "Browser wallet" }] : []
}

function sameSnapshot(a: EvmWalletSnapshot, b: EvmWalletSnapshot): boolean {
    return a.status === b.status && a.address === b.address && a.displayAddress === b.displayAddress && a.chainId === b.chainId
        && a.wallets.length === b.wallets.length && a.wallets.every((w, i) => w.uid === b.wallets[i].uid && w.name === b.wallets[i].name && w.icon === b.wallets[i].icon)
}

export function createEvmWallet(config: Config) {
    function read(): EvmWalletSnapshot {
        const c = getConnection(config)
        return {
            status: c.status,
            address: c.address ? c.address.toLowerCase() : "",
            // wagmi hands addresses over in their EIP-55 form already.
            displayAddress: c.address ?? "",
            chainId: c.status === "connected" ? c.chainId : null,
            wallets: walletOptions(config),
        }
    }
    let snapshot = read()
    const listeners = new Set<() => void>()
    let unwatch: (() => void) | null = null

    function refresh() {
        const next = read()
        if (sameSnapshot(next, snapshot)) return
        snapshot = next
        for (const l of listeners) l()
    }

    return {
        getSnapshot: () => snapshot,
        subscribe(listener: () => void): () => void {
            listeners.add(listener)
            if (!unwatch) {
                const stopConnection = watchConnection(config, { onChange: refresh })
                const stopConnectors = watchConnectors(config, { onChange: refresh })
                unwatch = () => { stopConnection(); stopConnectors() }
                refresh()
            }
            return () => {
                listeners.delete(listener)
                if (listeners.size === 0 && unwatch) { unwatch(); unwatch = null }
            }
        },
        connect(uid: string): Promise<WalletOutcome> {
            const connector = config.connectors.find((k) => k.uid === uid)
            if (!connector) return Promise.resolve({ ok: false, reason: "failed" })
            return outcome(async () => { await connect(config, { connector }); refresh() })
        },
        async disconnect(): Promise<void> {
            await disconnect(config).catch(() => { /* the wallet may already be gone */ })
            refresh()
        },
        switchChain(chainId: number): Promise<WalletOutcome> {
            return outcome(async () => { await switchChain(config, { chainId: chainId as Config["chains"][number]["id"] }); refresh() })
        },
        /**
         * Asks the wallet to sign `message` (personal_sign). The signature is returned
         * exactly as the wallet gives it: a smart wallet's EIP-1271 / ERC-6492 form included.
         */
        /** `account`: the address that must sign; wagmi refuses if the wallet no longer connects it. */
        async signMessage(message: string, account: string): Promise<{ ok: true; signature: string } | { ok: false; reason: "declined" | "failed" }> {
            try {
                return { ok: true, signature: await signMessage(config, { message, account: account as `0x${string}` }) }
            } catch (err) {
                return { ok: false, reason: declinedInWallet(err) ? "declined" : "failed" }
            }
        },
        /** Silent reconnect of the wallet used last, on load. */
        async reconnect(): Promise<void> {
            await reconnect(config).catch(() => { /* nothing to restore */ })
            refresh()
        },
    }
}

export type EvmWallet = ReturnType<typeof createEvmWallet>
