/**
 * The connect flow on an EVM network: pick one of the wallets this browser
 * announced → approve in it → the sign-in step, which first gets the wallet
 * onto Memba's chain. Same dialog frame and keys as the Gno one (ConnectModal).
 *
 * @module os/evm/EvmConnectModal
 */
import { useEffect, useRef, useState, type ReactNode } from "react"
import { Head, Waiting } from "../shell/ConnectModal"
import { shortAddr } from "../shell/format"
import { useDialogKeys } from "../shell/useDialogKeys"
import type { OsSession } from "../shell/useOsSession"

export function EvmConnectModal({ session }: { session: OsSession }) {
    const { stage, error, evm, network } = session
    const dialog = useRef<HTMLDivElement>(null)
    // The chain the wallet was on when a switch to Memba's failed: the failure stands while the wallet still reports it.
    const [switchFailedOn, setSwitchFailedOn] = useState<string | null>(null)
    useEffect(() => {
        if (!stage || !dialog.current) return
        if (dialog.current.contains(document.activeElement)) return
        const first = dialog.current.querySelector<HTMLElement>("button:not(:disabled), a[href]")
        ;(first ?? dialog.current).focus({ preventScroll: true })
    }, [stage])
    useDialogKeys(dialog, !!stage, "button:not(:disabled), a[href]", session.cancel)
    if (!stage || !evm) return null
    let body: ReactNode
    if (stage === "approve") {
        body = <>
            <Head title="Approve in your wallet" sub="Your wallet asks whether Memba may see your address." />
            <Waiting label="Waiting for your wallet…" />
            <div className="os-row os-end"><button type="button" className="os-btn os-quiet" onClick={session.cancel}>Cancel</button></div>
        </>
    } else if (stage === "login") {
        const switchFailed = switchFailedOn !== null && switchFailedOn === session.walletChainId
        const switchChain = async () => {
            const from = session.walletChainId
            if (!(await session.switchWallet())) setSwitchFailedOn(from)
        }
        body = <>
            <Head title={`Connected · ${shortAddr(session.walletAddress)}`} sub={`Memba is on ${network.label}.`} />
            {evm.wrongChain
                ? <>
                    <p className="os-note os-warn" role="status">Your wallet is on chain {session.walletChainId}. Switch it to {network.label} to sign in.</p>
                    {switchFailed && <p className="os-note os-err" role="alert">The wallet didn't switch. Switch it to {network.label} (chain {network.chainId}) in the wallet itself.</p>}
                    <div className="os-row os-end">
                        <button type="button" className="os-btn os-quiet" onClick={session.disconnect}>Disconnect</button>
                        <button type="button" className="os-btn" onClick={() => { void switchChain() }}>Switch wallet to {network.label}</button>
                    </div>
                </>
                : <>
                    <p className="os-sub">Signing in to Memba with this wallet comes in an update soon. Until then you browse as a guest.</p>
                    <div className="os-row os-end">
                        <button type="button" className="os-btn os-quiet" onClick={session.disconnect}>Disconnect</button>
                        <button type="button" className="os-btn" onClick={session.cancel}>Done</button>
                    </div>
                </>}
        </>
    } else {
        body = <>
            <Head title="Connect a wallet" sub="Signing needs your approval in the wallet. Memba never holds your keys." />
            {evm.wallets.length > 0
                ? evm.wallets.map((w) => (
                    <button key={w.uid} type="button" className="os-wopt" onClick={() => evm.choose(w.uid)}>
                        {w.icon && <img src={w.icon} alt="" width={36} height={36} className="os-wlogo" />}
                        <span className="os-grow"><b>{w.name}</b></span>
                    </button>
                ))
                : <p className="os-note" role="status">No wallet found in this browser. Install a browser wallet such as Rabby, MetaMask or Coinbase Wallet, then reload this page.</p>}
            <div className="os-row os-end"><button type="button" className="os-btn os-quiet" onClick={session.cancel}>Not now</button></div>
        </>
    }
    return (
        <div className="os-scrim os-scrim-center" onClick={(e) => { if (e.target === e.currentTarget) session.cancel() }}>
            <div ref={dialog} className="os-modal os-glass" role="dialog" aria-modal="true" aria-label="Connect a wallet" tabIndex={-1}>
                {body}
                {error && <p className="os-note os-err" role="alert">{error}</p>}
            </div>
        </div>
    )
}
