import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { formatSend } from "../sign/decode"
import { ACTIVATION_SEND_UGNOT } from "../../lib/activation"
// Adena's own app icon, unaltered, from its brand kit (docs.adena.app → Resources → Brand Assets → Download Logo, "app icon").
import adenaLogo from "./adena-logo.svg"
import { shortAddr } from "./format"
import { useDialogKeys } from "./useDialogKeys"
import type { OsSession } from "./useOsSession"
import { walletOnOtherChain } from "./walletLogin"

/** GNOT exactly, never rounded: "0.0024 GNOT". */
const exact = (ugnot: bigint | number) => formatSend(`${ugnot}ugnot`)

/** What Adena shows for the activation, as Adena 1.21.6 renders a bank send (its default message view). */
function AdenaShows() {
    return (
        <>
            <dl className="os-kv os-card" aria-label="Adena should show">
                <dt>Message</dt><dd>1. Transfer</dd>
                <dt>type</dt><dd className="os-mono">/bank.MsgSend</dd>
                <dt>function</dt><dd className="os-mono">Transfer</dd>
                <dt>Memo</dt><dd>Memba Network Activation</dd>
            </dl>
            <p className="os-sub os-flush">Adena does not show a transfer’s recipient or amount: this one is {exact(ACTIVATION_SEND_UGNOT)} to your own address.</p>
        </>
    )
}

export function Head({ title, sub }: { title: string; sub?: string }) {
    return (
        <>
            <h2 className="os-modal-title">{title}</h2>
            {sub && <p className="os-sub os-modal-sub">{sub}</p>}
        </>
    )
}

export function Waiting({ label }: { label: string }) {
    return <div className="os-row" role="status"><span className="os-spin" aria-hidden="true" /><span className="os-sub">{label}</span></div>
}

/**
 * The connect flow (mockup v4 modalHTML): pick a wallet → Adena not installed
 * / approve in Adena → sign the login message → activate an untransacted
 * address. Every step on the real wallet and login code (useOsSession).
 */
export function ConnectModal({ session }: { session: OsSession }) {
    const { stage, error, note } = session
    const mobileBrowser = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
    const dialog = useRef<HTMLDivElement>(null)
    // The network Adena was on when a switch to Memba's failed: the failure stands while Adena still reports it.
    const [switchFailedOn, setSwitchFailedOn] = useState<string | null>(null)
    const otherChain = stage === "login" ? walletOnOtherChain(session.walletChainId, session.network.chainId) : null
    useEffect(() => {
        if (!stage || !dialog.current) return
        if (dialog.current.contains(document.activeElement)) return
        const first = dialog.current.querySelector<HTMLElement>('button:not(:disabled), a[href]')
        ;(first ?? dialog.current).focus({ preventScroll: true })
    }, [stage])
    const closeable = !!stage && !(stage === "activate" && session.activationForced) && stage !== "activatewait"
    useDialogKeys(dialog, !!stage, "button:not(:disabled), a[href]", closeable ? session.cancel : undefined)
    if (!stage) return null
    const cost = session.activationCost
    let body: ReactNode
    switch (stage) {
        case "pick":
            body = <>
                <Head title="Connect a wallet" sub="Voting, signing and posting need your approval in the wallet. Memba never holds your keys." />
                <button type="button" className="os-wopt" onClick={session.chooseAdena} autoFocus>
                    <img src={adenaLogo} alt="" width={36} height={36} className="os-wlogo" />
                    <span className="os-grow"><b>Adena</b><span className="os-sub os-block">The gno.land wallet · works with Ledger</span></span>
                </button>
                <div className="os-row os-end"><button type="button" className="os-btn os-quiet" onClick={session.cancel}>Not now</button></div>
            </>
            break
        case "missing":
            body = <>
                <Head title={mobileBrowser ? "Wallet connection needs desktop" : "Adena isn’t installed"}
                    sub={mobileBrowser ? "Adena's mobile wallet is not available yet. You can keep browsing here, then connect from a supported desktop browser." : "Adena is the gno.land wallet. Install it, then come back to this tab."} />
                {!mobileBrowser && <div className="os-card">
                    <ol className="os-steps">
                        <li>Get Adena at <a href="https://www.adena.app" target="_blank" rel="noreferrer">adena.app</a> (Chrome, Edge or Brave)</li>
                        <li>Create or import your account</li>
                        <li>Come back here and press Continue</li>
                    </ol>
                </div>}
                <div className="os-row os-end">
                    <button type="button" className="os-btn os-quiet" onClick={session.cancel}>Not now</button>
                    {!mobileBrowser && <button type="button" className="os-btn" onClick={session.recheck} autoFocus>Continue</button>}
                </div>
            </>
            break
        case "approve":
            body = <>
                <Head title="Approve in Adena" sub="Adena asks whether Memba may see your address." />
                <Waiting label="Waiting for Adena…" />
                <div className="os-row os-end"><button type="button" className="os-btn os-quiet" onClick={session.cancel}>Cancel</button></div>
            </>
            break
        case "login": {
            const chain = session.network.chainId
            const switchWallet = async () => {
                const from = session.walletChainId
                setSwitchFailedOn(null)
                if (!(await session.switchWallet())) setSwitchFailedOn(from)
            }
            body = <>
                <Head title="Sign the login message" sub="It proves you own this address. It’s never sent to the chain and costs nothing." />
                {note && <p className="os-note" role="status">{note}</p>}
                <dl className="os-kv os-card">
                    <dt>Address</dt><dd className="os-mono">{shortAddr(session.walletAddress)}</dd>
                    <dt>Network</dt><dd>{session.network.chainId}</dd>
                    <dt>Cost</dt><dd>Free</dd>
                </dl>
                {otherChain && <p className="os-note os-err" role="alert">
                    {switchFailedOn === session.walletChainId ? `Adena didn't switch to ${chain}. Switch it to ${chain} in Adena, then sign in.` : otherChain}
                </p>}
                <div className="os-row os-end">
                    <button type="button" className="os-btn os-quiet" onClick={session.cancel}>Cancel</button>
                    {otherChain
                        ? <button type="button" className="os-btn" onClick={() => { void switchWallet() }} autoFocus>Switch Adena to {chain}</button>
                        : <button type="button" className="os-btn" onClick={session.signIn} autoFocus>Sign in Adena</button>}
                </div>
            </>
            break
        }
        case "loginwait":
            body = <>
                <Head title="Confirm in Adena" sub="Sign the login message." />
                <Waiting label="Waiting for Adena…" />
                <div className="os-row os-end"><button type="button" className="os-btn os-quiet" onClick={session.cancel}>Cancel</button></div>
            </>
            break
        case "activate":
            body = <>
                <Head title="Activate your address" sub="Your address has never sent a transaction, so the chain doesn’t know its public key yet. Memba needs it to check your signatures." />
                <dl className="os-kv os-card">
                    <dt>What happens</dt><dd>Sends {exact(ACTIVATION_SEND_UGNOT)} from your address to itself</dd>
                    <dt>How often</dt><dd>Once, never again</dd>
                    <dt>Network fee</dt><dd>{cost ? `${session.activationPriceEstimated ? "about " : ""}${exact(cost.feeUgnot)}` : "reading the network price…"}</dd>
                </dl>
                <p className="os-sub os-flush">Your wallet sets the fee it signs from its own gas estimate, usually lower than the figure above. Check the fee in Adena before you approve.</p>
                <AdenaShows />
                {session.noFunds && cost && <p className="os-note os-warn" role="status">Activation needs at least {exact(BigInt(cost.feeUgnot) + ACTIVATION_SEND_UGNOT)} here: the network fee and the {exact(ACTIVATION_SEND_UGNOT)} sent to yourself. Send this address at least that much, then activate.</p>}
                {session.balanceUnknown && <p className="os-note os-warn" role="status">{session.balanceError ? "Balance unavailable. Retry the check before activating." : "Checking this address's GNOT balance…"}</p>}
                <div className="os-row os-end">
                    {closeable && <button type="button" className="os-btn os-quiet" onClick={session.cancel}>Later</button>}
                    {session.balanceUnknown && <button type="button" className="os-btn os-quiet" onClick={() => { void session.refreshBalance() }}>Retry balance check</button>}
                    <button type="button" className="os-btn" onClick={session.activate} disabled={session.noFunds || session.balanceUnknown || !cost} autoFocus>Activate in Adena</button>
                </div>
            </>
            break
        case "activatewait":
            body = <><Head title="Confirm in Adena" sub="Approve the activation. Check Adena shows:" /><AdenaShows /><Waiting label="Waiting for Adena…" /></>
            break
    }
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Escape" && closeable) {
            e.preventDefault()
            session.cancel()
        }
    }
    return (
        <div className="os-scrim os-scrim-center" onClick={(e) => { if (closeable && e.target === e.currentTarget) session.cancel() }}>
            <div ref={dialog} className="os-modal os-glass" role="dialog" aria-modal="true" aria-label="Connect a wallet" tabIndex={-1}
                onKeyDown={onKeyDown}>
                {body}
                {/* The network note replaces an error from a sign-in it explains. */}
                {error && !otherChain && <p className="os-note os-err" role="alert">{error}</p>}
            </div>
        </div>
    )
}
