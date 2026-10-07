/**
 * Propose a payment from a Safe: one or more ETH or ERC-20 sends (several run
 * as one call-only batch), reviewed with every address in full and the
 * address-poisoning checks, then signed by the proposing owner (EIP-712, no
 * gas) and handed to the Safe Transaction Service for the other owners.
 *
 * Guests see the form; a wallet that owns the Safe is asked for at review.
 *
 * @module os/multisig/evm/ProposeSafe
 */
import { useState, type FormEvent } from "react"
import { erc20TransferData } from "../../../lib/chain/evm/safe/decode"
import { loadSafeSdk } from "../../../lib/chain/evm/safe/load"
import { addressGroups, knownRecipients, parseRecipient, recipientWarnings, type RecipientWarning } from "../../../lib/chain/evm/safe/recipients"
import type { Hex } from "../../../lib/chain/evm/safe/known"
import type { SafeCall } from "../../../lib/chain/evm/safe/transact"
import { API_BASE_URL } from "../../../lib/config"
import type { OsSession } from "../../shell/useOsSession"
import { specForTarget, type WindowSpec } from "../../shell/windows"
import { Loading } from "../MultisigParts"
import { actionErrorText, formatUnits, parseAmount } from "./describe"
import { safeNetworkOf, useSafeFacts } from "./useSafes"

interface Draft {
    recipient: string
    token: string // "" = ETH
    amount: string
}

interface Line {
    call: SafeCall
    recipient: Hex
    display: string
    amount: string
    warnings: (RecipientWarning | { code: "token-name"; severity: "caution"; text: string })[]
}

const EMPTY: Draft = { recipient: "", token: "", amount: "" }
const MAX_LINES = 10

function Full({ display }: { display: string }) {
    return <span className="os-mono os-break" aria-label={display}>{addressGroups(display).join(" ")}</span>
}

export function ProposeSafe({ address, session, open }: { address: string; session: OsSession; open: (spec: WindowSpec) => void }) {
    const net = safeNetworkOf(session)
    const safe = address.toLowerCase() as Hex
    const facts = useSafeFacts(net, safe)
    const inspection = facts.data?.inspection
    const s = inspection?.kind === "ok" && inspection.value.kind === "safe" ? inspection.value : null
    const me = session.walletAddress?.toLowerCase() ?? ""
    const [drafts, setDrafts] = useState<Draft[]>([{ ...EMPTY }])
    const [lines, setLines] = useState<Line[] | null>(null)
    const [acknowledged, setAcknowledged] = useState(false)
    const [busy, setBusy] = useState<"" | "review" | "sign">("")
    const [error, setError] = useState<string | null>(null)
    const [done, setDone] = useState(false)

    if (facts.isPending) return <Loading what="this Safe" />
    if (!s) return <p className="os-note os-err" role="alert">This address isn't a Safe Memba can read on {session.network.label}. Open it from the Multisig app to see why.</p>

    const set = (i: number, patch: Partial<Draft>) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)))

    const review = async (e: FormEvent) => {
        e.preventDefault()
        setError(null)
        if (!me) { session.openConnect(); return }
        if (!s.owners.some((o) => o === me)) { setError("This wallet is not an owner of this Safe: only owners can propose."); return }
        setBusy("review")
        try {
            const sdk = await loadSafeSdk()
            const checksum = (a: string) => sdk.toChecksum(a)
            // Only the owners are known recipients: the Transaction Service's history is not proof of who was paid.
            const known = knownRecipients({ owners: s.owners })
            const out: Line[] = []
            for (const [i, d] of drafts.entries()) {
                const n = drafts.length > 1 ? `Payment ${i + 1}: ` : ""
                const to = parseRecipient(d.recipient, checksum)
                if (!to.ok) { setError(`${n}${to.error}`); return }
                let token: { address: Hex; symbol: string; decimals: number } | null = null
                if (d.token.trim() && d.token.trim().toUpperCase() !== "ETH") {
                    const t = parseRecipient(d.token, checksum)
                    if (!t.ok) { setError(`${n}token: ${t.error}`); return }
                    const info = await sdk.readToken(net.key, t.address)
                    if (info.kind !== "ok") { setError(`${n}token: ${info.reason}.`); return }
                    token = { address: t.address, ...info.value }
                }
                const amount = parseAmount(d.amount, token?.decimals ?? 18)
                if (!amount.ok) { setError(`${n}${amount.error}`); return }
                const contract = await sdk.isContract(net.key, to.address)
                out.push({
                    call: token ? { to: token.address, value: 0n, data: erc20TransferData(to.address, amount.value) } : { to: to.address, value: amount.value, data: "0x" },
                    recipient: to.address,
                    display: to.display,
                    amount: `${formatUnits(amount.value, token?.decimals ?? 18)} ${token ? `${token.symbol} (token ${checksum(token.address)})` : "ETH"}`,
                    warnings: [
                        ...recipientWarnings(to.address, { safe, token: token?.address, known, isContract: contract.kind === "ok" ? contract.value : undefined }),
                        ...(token ? [{ code: "token-name" as const, severity: "caution" as const, text: "Any token can take any name, ETH included: check the token's address." }] : []),
                    ],
                })
            }
            setAcknowledged(false)
            setLines(out)
        } catch {
            setError("Couldn't prepare the payment. Try again.")
        } finally {
            setBusy("")
        }
    }

    const propose = async () => {
        if (!lines) return
        setError(null)
        setBusy("sign")
        try {
            const sdk = await loadSafeSdk()
            try {
                await sdk.proposeSafeTx(net.key, API_BASE_URL, safe, lines.map((l) => l.call))
                setDone(true)
            } catch (err) {
                setError(err instanceof sdk.SafeActionError ? actionErrorText(err.reason, session.network.label, "propose") : "Couldn't propose the payment. Try again.")
            }
        } catch {
            setError("Couldn't load what signs Safe transactions. Try again.")
        } finally {
            setBusy("")
        }
    }

    const backToSafe = () => open(specForTarget({ kind: "multisig", address: safe })!)

    if (done) {
        return (
            <div className="os-stack">
                <h3 className="os-h">Proposed</h3>
                <p className="os-sub">Your signature is in. It runs once {s.threshold} of {s.owners.length} owners have signed and someone executes it.</p>
                <div className="os-row"><button type="button" className="os-btn" onClick={backToSafe}>Back to the Safe</button></div>
            </div>
        )
    }

    if (lines) {
        const danger = lines.some((l) => l.warnings.some((w) => w.severity === "danger"))
        return (
            <div className="os-stack">
                <h3 className="os-h">Review the payment{lines.length > 1 ? "s" : ""}</h3>
                {lines.length > 1 && <p className="os-sub">These {lines.length} payments run together as one transaction: all or none.</p>}
                <ul className="os-list">{lines.map((l, i) => (
                    <li key={i} className="os-it os-top"><div className="os-grow">
                        <b>Send {l.amount}</b>
                        <div className="os-sub">to <Full display={l.display} /></div>
                        {l.warnings.map((w) => <p key={w.code} className={`os-note ${w.severity === "danger" ? "os-err" : "os-warn"}`} role={w.severity === "danger" ? "alert" : "status"}>{w.text}</p>)}
                    </div></li>
                ))}</ul>
                <p className="os-sub">You sign it in your wallet, without paying gas. {s.threshold > 1 ? `${s.threshold - 1} more owner${s.threshold > 2 ? "s" : ""} must sign before it can run.` : "Then anyone can execute it."}</p>
                {danger && <label className="os-row"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> <span className="os-sub">I compared every character of the address with the recipient.</span></label>}
                {error && <p className="os-note os-err" role="alert">{error}</p>}
                {busy === "sign" && <p className="os-sub" role="status">Sign in your wallet…</p>}
                <div className="os-row">
                    <button type="button" className="os-btn" disabled={busy !== "" || (danger && !acknowledged)} onClick={() => { void propose() }}>Sign and propose</button>
                    <button type="button" className="os-btn os-quiet" disabled={busy !== ""} onClick={() => { setLines(null); setError(null) }}>Edit</button>
                </div>
            </div>
        )
    }

    return (
        <form className="os-stack" onSubmit={(e) => { void review(e) }}>
            <h3 className="os-h">New payment from this Safe</h3>
            <p className="os-sub os-mono os-break">{addressGroups(facts.data?.display[safe] ?? safe).join(" ")}</p>
            {drafts.map((d, i) => (
                <fieldset key={i} className="os-stack os-tight">
                    <legend className="os-sub">{drafts.length > 1 ? `Payment ${i + 1}` : "Payment"}</legend>
                    <input className="os-in os-mono" aria-label={`Recipient ${i + 1}`} placeholder="Recipient 0x… address" value={d.recipient} onChange={(e) => set(i, { recipient: e.target.value })} autoComplete="off" spellCheck={false} />
                    <div className="os-row">
                        <input className="os-in" aria-label={`Amount ${i + 1}`} placeholder="Amount" inputMode="decimal" value={d.amount} onChange={(e) => set(i, { amount: e.target.value })} autoComplete="off" />
                        <input className="os-in os-mono" aria-label={`Token ${i + 1}`} placeholder="ETH, or a token 0x… address" value={d.token} onChange={(e) => set(i, { token: e.target.value })} autoComplete="off" spellCheck={false} />
                        {drafts.length > 1 && <button type="button" className="os-btn os-quiet" aria-label={`Remove payment ${i + 1}`} onClick={() => setDrafts((x) => x.filter((_, j) => j !== i))}>Remove</button>}
                    </div>
                </fieldset>
            ))}
            {drafts.length < MAX_LINES && <div className="os-row"><button type="button" className="os-btn os-quiet" onClick={() => setDrafts((x) => [...x, { ...EMPTY }])}>Add a payment</button></div>}
            <p className="os-sub">Paste addresses from a source you trust: Memba never fills them in from this Safe's received transfers.</p>
            {error && <p className="os-note os-err" role="alert">{error}</p>}
            <div className="os-row"><button type="submit" className="os-btn" disabled={busy !== ""}>{busy === "review" ? "Checking…" : me ? "Review" : "Connect a wallet to review"}</button></div>
        </form>
    )
}
