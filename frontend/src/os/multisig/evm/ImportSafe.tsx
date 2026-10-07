/**
 * Import a Safe into your Multisig list: paste its address, Memba reads what
 * the chain says it is (version, owners, threshold, modules, guards), and
 * adds it with an optional name. Only a Safe Memba recognises, and that the
 * signed-in account owns, can be added: the server checks both on chain too.
 * A Safe with modules, guards or an unknown fallback handler shows each one,
 * and needs a confirmation before it is added.
 *
 * Guests see the whole form; signing in is asked for at the last step.
 *
 * @module os/multisig/evm/ImportSafe
 */
import { useState, type FormEvent } from "react"
import { NOT_A_SAFE_TEXT, type SafeInspection } from "../../../lib/chain/evm/safe/inspect"
import { loadSafeSdk } from "../../../lib/chain/evm/safe/load"
import { addressGroups, parseRecipient } from "../../../lib/chain/evm/safe/recipients"
import type { Hex } from "../../../lib/chain/evm/safe/known"
import type { OsSession } from "../../shell/useOsSession"
import { specForTarget, type WindowSpec } from "../../shell/windows"
import { registerErrorText, useRegisterSafe, useSafeToken } from "./useMySafes"
import { safeNetworkOf } from "./useSafes"

type Checked = { safe: Extract<SafeInspection, { kind: "safe" }>; display: Record<string, string> }

function Full({ display }: { display: string }) {
    return <span className="os-mono os-break" aria-label={display}>{addressGroups(display).join(" ")}</span>
}

export function ImportSafe({ session, open }: { session: OsSession; open: (spec: WindowSpec) => void }) {
    const net = safeNetworkOf(session)
    const token = useSafeToken(session)
    const register = useRegisterSafe(net, token)
    const me = session.walletAddress?.toLowerCase() ?? ""
    const [draft, setDraft] = useState("")
    const [name, setName] = useState("")
    const [checked, setChecked] = useState<Checked | null>(null)
    const [acknowledged, setAcknowledged] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const check = async (e: FormEvent) => {
        e.preventDefault()
        setError(null)
        setChecked(null)
        setBusy(true)
        try {
            const sdk = await loadSafeSdk()
            const parsed = parseRecipient(draft, (a) => sdk.toChecksum(a))
            if (!parsed.ok) { setError(parsed.error); return }
            const inspection = await sdk.inspect(net.key, parsed.address)
            if (inspection.kind === "unavailable") { setError(`Couldn't check this address on ${session.network.label}: ${inspection.reason}. Try again.`); return }
            if (inspection.value.kind === "not-a-safe") { setError(NOT_A_SAFE_TEXT[inspection.value.reason]); return }
            const safe = inspection.value
            const shown = [safe.address, ...safe.owners, ...safe.warnings.flatMap((w) => w.addresses)]
            setAcknowledged(false)
            setChecked({ safe, display: Object.fromEntries(shown.map((a) => [a, sdk.toChecksum(a)])) })
        } catch {
            setError("Couldn't check this address. Try again.")
        } finally {
            setBusy(false)
        }
    }

    const add = async () => {
        if (!checked) return
        setError(null)
        try {
            await register.mutateAsync({ address: checked.safe.address, name: name.trim(), joined: true })
            open(specForTarget({ kind: "multisig", address: checked.safe.address })!)
        } catch (err) {
            setError(registerErrorText(err))
        }
    }

    const s = checked?.safe
    const owner = !!s && s.owners.includes(me as Hex)
    const risky = !!s && s.warnings.length > 0
    return (
        <div className="os-stack">
            <form className="os-stack os-tight" onSubmit={(e) => { void check(e) }}>
                <h3 className="os-h">Import a Safe on {session.network.label}</h3>
                <p className="os-sub">Paste the address of a Safe you own. Memba reads what it is from the chain before adding it to your list.</p>
                <div className="os-row">
                    <input className="os-in os-mono" aria-label="Safe address" placeholder="0x… Safe address" value={draft} onChange={(e) => { setDraft(e.target.value); setChecked(null) }} autoComplete="off" spellCheck={false} />
                    <button type="submit" className="os-btn os-quiet" disabled={busy || !draft.trim()}>{busy ? "Checking…" : "Check"}</button>
                </div>
            </form>
            {s && checked && <section className="os-stack os-tight" aria-label="What the chain says">
                <Full display={checked.display[s.address]} />
                <p className="os-sub">Safe v{s.version}{s.l2 ? "" : " (non-L2)"} · {s.threshold} of {s.owners.length} owners · nonce {s.nonce.toString()}</p>
                <ul className="os-list">{s.owners.map((o) => <li key={o}><Full display={checked.display[o]} />{o === me && <span className="os-pill">You</span>}</li>)}</ul>
                {s.warnings.map((w) => (
                    <div key={w.code} className={`os-note ${w.severity === "danger" ? "os-err" : "os-warn"}`} role={w.severity === "danger" ? "alert" : "status"}>
                        {w.text}{w.addresses.map((a) => <div key={a}><Full display={checked.display[a]} /></div>)}
                    </div>
                ))}
                {!me ? <p className="os-sub" role="status">Connect the wallet that owns this Safe to import it. <button type="button" className="os-btn os-quiet os-inline" onClick={session.openConnect}>Connect</button></p>
                    : !owner ? <p className="os-note os-warn" role="status">The connected wallet is not an owner of this Safe: only an owner can keep it in their list.</p>
                    : !token ? <p className="os-sub" role="status">Sign in with this wallet to keep the Safe in your list. <button type="button" className="os-btn os-quiet os-inline" onClick={session.openConnect}>Sign in</button></p>
                    : <>
                        <label className="os-stack os-tight"><span className="os-sub">Name (optional, shared with the other owners who use Memba)</span>
                            <input className="os-in" aria-label="Safe name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>
                        {risky && <label className="os-row"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> <span className="os-sub">I know what each module, guard and handler above does.</span></label>}
                        <div className="os-row"><button type="button" className="os-btn" disabled={register.isPending || (risky && !acknowledged)} onClick={() => { void add() }}>{register.isPending ? "Adding…" : "Add to my Safes"}</button></div>
                    </>}
            </section>}
            {error && <p className="os-note os-err" role="alert">{error}</p>}
        </div>
    )
}
