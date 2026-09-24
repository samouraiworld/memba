import type { ReactNode } from "react"
import { shortAddr } from "./format"
import { ThingTile } from "./icons"
import type { OsSession } from "./useOsSession"

const ADENA_TINT = ["#7E6CF2", "#4B3FD0"] as const

function Head({ title, sub }: { title: string; sub?: string }) {
    return (
        <>
            <h2 className="os-modal-title">{title}</h2>
            {sub && <p className="os-sub os-modal-sub">{sub}</p>}
        </>
    )
}

function Waiting({ label }: { label: string }) {
    return <div className="os-row" role="status"><span className="os-spin" aria-hidden="true" /><span className="os-sub">{label}</span></div>
}

/**
 * The connect flow (mockup v4 modalHTML): pick a wallet → Adena not installed
 * / approve in Adena → sign the login message → activate an untransacted
 * address. Every step on the real wallet and login code (useOsSession).
 */
export function ConnectModal({ session }: { session: OsSession }) {
    const { stage, error, note } = session
    if (!stage) return null
    const closeable = !(stage === "activate" && session.activationForced) && stage !== "activatewait"
    let body: ReactNode
    switch (stage) {
        case "pick":
            body = <>
                <Head title="Connect a wallet" sub="Voting, signing and posting need your approval in the wallet. Memba never holds your keys." />
                <button type="button" className="os-wopt" onClick={session.chooseAdena} autoFocus>
                    <ThingTile icon="wal" tint={ADENA_TINT} size={36} />
                    <span className="os-grow"><b>Adena</b><span className="os-sub os-block">The gno.land wallet · works with Ledger</span></span>
                </button>
                <div className="os-row os-end"><button type="button" className="os-btn os-quiet" onClick={session.cancel}>Not now</button></div>
            </>
            break
        case "missing":
            body = <>
                <Head title="Adena isn’t installed" sub="Adena is the gno.land wallet. Install it, then come back to this tab." />
                <div className="os-card">
                    <ol className="os-steps">
                        <li>Get Adena at <a href="https://www.adena.app" target="_blank" rel="noreferrer">adena.app</a> (Chrome, Brave, Firefox)</li>
                        <li>Create or import your account</li>
                        <li>Come back here and press Continue</li>
                    </ol>
                </div>
                <div className="os-row os-end">
                    <button type="button" className="os-btn os-quiet" onClick={session.cancel}>Not now</button>
                    <button type="button" className="os-btn" onClick={session.recheck} autoFocus>Continue</button>
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
        case "login":
            body = <>
                <Head title="Sign the login message" sub="It proves you own this address. It’s never sent to the chain and costs nothing." />
                {note && <p className="os-note" role="status">{note}</p>}
                <dl className="os-kv os-card">
                    <dt>Address</dt><dd className="os-mono">{shortAddr(session.walletAddress)}</dd>
                    <dt>Network</dt><dd>{session.network.chainId}</dd>
                    <dt>Cost</dt><dd>Free</dd>
                </dl>
                <div className="os-row os-end">
                    <button type="button" className="os-btn os-quiet" onClick={session.cancel}>Cancel</button>
                    <button type="button" className="os-btn" onClick={session.signIn} autoFocus>Sign in Adena</button>
                </div>
            </>
            break
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
                    <dt>What happens</dt><dd>Saves an empty profile field</dd>
                    <dt>Network</dt><dd>{session.network.chainId}</dd>
                    <dt>Cost</dt><dd>≈ 0.01 GNOT</dd>
                    <dt>How often</dt><dd>Once, never again</dd>
                </dl>
                {session.noFunds && <p className="os-note os-warn" role="status">This address holds no GNOT yet. Send it a little (0.01 GNOT is enough), then activate.</p>}
                <div className="os-row os-end">
                    {closeable && <button type="button" className="os-btn os-quiet" onClick={session.cancel}>Later</button>}
                    <button type="button" className="os-btn" onClick={session.activate} disabled={session.noFunds} autoFocus>Activate in Adena</button>
                </div>
            </>
            break
        case "activatewait":
            body = <><Head title="Confirm in Adena" sub="Approve the activation." /><Waiting label="Waiting for Adena…" /></>
            break
    }
    return (
        <div className="os-scrim os-scrim-center" onClick={(e) => { if (closeable && e.target === e.currentTarget) session.cancel() }}>
            <div className="os-modal os-glass" role="dialog" aria-modal="true" aria-label="Connect a wallet"
                onKeyDown={(e) => { if (e.key === "Escape" && closeable) session.cancel() }}>
                {body}
                {error && <p className="os-note os-err" role="alert">{error}</p>}
            </div>
        </div>
    )
}
