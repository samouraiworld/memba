/**
 * The Multisig app's network-neutral pieces: loading and connect prompts, the
 * threshold avatar, member chips, signature dots and the copy-address button.
 * They take plain values (addresses, counts, callbacks), never a chain's
 * records, so any network's multisig window can draw the same account.
 *
 * @module os/multisig/MultisigParts
 */
import { useState } from "react"
import { shortAddr } from "../shell/format"

export function Loading({ what }: { what: string }) {
    return <div className="os-row" role="status"><span className="os-spin" aria-hidden="true" /><span className="os-sub">Loading {what}…</span></div>
}

/** Where a guest's own data would be: why it is not shown, and the way to show it. */
export function ConnectHere({ resuming, onConnect, text }: { resuming: boolean; onConnect: () => void; text: string }) {
    if (resuming) return <Loading what="your wallet" />
    return (
        <p className="os-sub" role="status">
            {text} <button type="button" className="os-btn os-quiet os-inline" onClick={onConnect}>Connect</button>
        </p>
    )
}

/** "2/3": how many signatures out of how many members. */
export function ThresholdAvatar({ threshold, members }: { threshold: number; members: number }) {
    return <span className="os-av os-av-lg" aria-hidden="true">{threshold}/{members}</span>
}

/** The members, the connected one as "You". */
export function MemberChips({ members, me }: { members: readonly string[]; me: string }) {
    return <div className="os-chipset" aria-label="Members">{members.map((a) => <span key={a} className="os-pill os-mono" title={a}>{a === me ? "You" : shortAddr(a)}</span>)}</div>
}

/** One dot per member, lit when its signature is verified, and the counts beside them. */
export function SigDots({ members, signed, verified, threshold }: { members: readonly string[]; signed: ReadonlySet<string>; verified: ReadonlySet<string>; threshold: number }) {
    return (
        <div className="os-row os-tight">
            <span className="os-sigdots" aria-label={`${signed.size} submitted, ${verified.size} verified, threshold ${threshold}`}>
                {members.map((a) => <span key={a} className={verified.has(a) ? "os-on" : undefined} title={`${a}${signed.has(a) ? verified.has(a) ? ": verified" : ": submitted, unverified" : ": not signed"}`}>{a.slice(2, 3).toUpperCase()}</span>)}
            </span>
            <span className="os-sub">{signed.size} submitted · {verified.size} verified · threshold {threshold}</span>
        </div>
    )
}

/** Copies the address; the address stays visible on the page when the clipboard refuses. */
export function CopyAddressButton({ address, label }: { address: string; label: string }) {
    const [copied, setCopied] = useState(false)
    const copy = async () => {
        try { await navigator.clipboard.writeText(address); setCopied(true) } catch { /* the address stays visible */ }
    }
    return <button type="button" className="os-btn os-quiet" onClick={() => { void copy() }}>{copied ? "Address copied" : label}</button>
}
