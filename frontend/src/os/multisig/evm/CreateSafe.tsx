/**
 * Create a Safe on an EVM network: owners, threshold, review, then one
 * transaction from the connected wallet, which pays its gas. Always SafeL2
 * v1.5.0 with owners and threshold only; the deployment is checked before the
 * wallet sees it and the new Safe is read back from the chain after
 * (lib/chain/evm/safe/create.ts).
 *
 * Guests see the whole form; a wallet is asked for at the review step.
 *
 * @module os/multisig/evm/CreateSafe
 */
import { useState, type FormEvent } from "react"
import { EVM_NETWORKS } from "../../../lib/chain/evm/networks"
import { loadSafeSdk } from "../../../lib/chain/evm/safe/load"
import { addressGroups, parseRecipient } from "../../../lib/chain/evm/safe/recipients"
import type { Hex } from "../../../lib/chain/evm/safe/known"
import type { NewSafePlan } from "../../../lib/chain/evm/safe/create"
import type { OsSession } from "../../shell/useOsSession"
import { specForTarget, type WindowSpec } from "../../shell/windows"
import { actionErrorText } from "./describe"
import { clearPendingCreation, loadPendingCreation, savePendingCreation } from "./pendingCreation"
import { safeNetworkOf } from "./useSafes"

type Stage =
    | { kind: "edit" }
    | { kind: "planning" }
    | { kind: "review"; plan: NewSafePlan; display: Record<string, string> }
    | { kind: "wallet"; plan: NewSafePlan; display: Record<string, string> }
    // Sent: from here the hash is kept and nothing goes back to planning (a new plan would be a second Safe).
    | { kind: "mining"; plan: NewSafePlan; display: Record<string, string>; hash: Hex; stuck: boolean }
    | { kind: "done"; address: Hex; display: string; hash: Hex }

const MAX_OWNERS = 20

function explorerTx(networkKey: string, hash: string): string | null {
    return Object.hasOwn(EVM_NETWORKS, networkKey) && /^0x[0-9a-fA-F]{64}$/.test(hash) ? `${EVM_NETWORKS[networkKey].explorerUrl}/tx/${hash}` : null
}

function Full({ display }: { display: string }) {
    return <span className="os-mono os-break" aria-label={display}>{addressGroups(display).join(" ")}</span>
}

export function CreateSafe({ session, open }: { session: OsSession; open: (spec: WindowSpec) => void }) {
    const net = safeNetworkOf(session)
    const label = session.network.label
    const wallet = session.walletAddress?.toLowerCase() ?? ""
    const [owners, setOwners] = useState<string[]>(wallet ? [wallet] : [""])
    const [threshold, setThreshold] = useState(1)
    // A creation sent from this tab and not yet confirmed resumes where it was: never a second Safe.
    const [stage, setStage] = useState<Stage>(() => {
        const pending = loadPendingCreation(net.chainId)
        return pending ? { kind: "mining", plan: pending.plan, display: pending.display, hash: pending.hash, stuck: true } : { kind: "edit" }
    })
    const [error, setError] = useState<string | null>(null)

    const setOwner = (i: number, v: string) => setOwners((o) => o.map((x, j) => (j === i ? v : x)))
    const removeOwner = (i: number) => {
        setOwners((o) => o.filter((_, j) => j !== i))
        setThreshold((t) => Math.min(t, Math.max(1, owners.length - 1)))
    }

    const review = async (e: FormEvent) => {
        e.preventDefault()
        setError(null)
        if (!wallet) { session.openConnect(); return }
        setStage({ kind: "planning" })
        try {
            const sdk = await loadSafeSdk()
            const parsed: Hex[] = []
            for (const [i, draft] of owners.entries()) {
                const p = parseRecipient(draft, (a) => sdk.toChecksum(a))
                if (!p.ok) { setError(`Owner ${i + 1}: ${p.error}`); setStage({ kind: "edit" }); return }
                if (parsed.includes(p.address)) { setError(`Owner ${i + 1} is listed twice.`); setStage({ kind: "edit" }); return }
                parsed.push(p.address)
            }
            const plan = await sdk.planNewSafe(net.key, parsed, threshold)
            const display = Object.fromEntries([plan.predicted, ...plan.owners].map((a) => [a, sdk.toChecksum(a)]))
            setStage({ kind: "review", plan, display })
        } catch (err) {
            const sdk = await loadSafeSdk().catch(() => null)
            setError(sdk && err instanceof sdk.SafeActionError ? actionErrorText(err.reason, label) : "Couldn't prepare the Safe. Try again.")
            setStage({ kind: "edit" })
        }
    }

    const create = async () => {
        if (stage.kind !== "review") return
        const { plan, display } = stage
        setError(null)
        setStage({ kind: "wallet", plan, display })
        const sdk = await loadSafeSdk()
        let sent: Hex | null = null
        try {
            const { hash } = await sdk.deployNewSafe(net.key, plan, (h) => {
                sent = h
                savePendingCreation({ plan, hash: h, display })
                setStage({ kind: "mining", plan, display, hash: h, stuck: false })
            })
            clearPendingCreation(plan.chainId)
            setStage({ kind: "done", address: plan.predicted, display: display[plan.predicted] ?? plan.predicted, hash })
        } catch (err) {
            setError(err instanceof sdk.SafeActionError ? actionErrorText(err.reason, label) : "Couldn't create the Safe. Check your wallet's activity before trying again.")
            const code = err instanceof sdk.SafeActionError ? err.reason.code : null
            if (sent && (code === "reverted" || code === "not-the-safe")) clearPendingCreation(plan.chainId)
            if (sent) setStage({ kind: "mining", plan, display, hash: sent, stuck: true })
            else setStage(code === "unexpected-deployment" ? { kind: "edit" } : { kind: "review", plan, display })
        }
    }

    /** After a send: wait for it and check the Safe again, with the same hash (never a new creation). */
    const checkAgain = async () => {
        if (stage.kind !== "mining") return
        const { plan, display, hash } = stage
        setError(null)
        setStage({ ...stage, stuck: false })
        const sdk = await loadSafeSdk()
        try {
            await sdk.confirmNewSafe(net.key, plan, hash)
            clearPendingCreation(plan.chainId)
            setStage({ kind: "done", address: plan.predicted, display: display[plan.predicted] ?? plan.predicted, hash })
        } catch (err) {
            setError(err instanceof sdk.SafeActionError ? actionErrorText(err.reason, label) : "Couldn't check the Safe yet. Try again in a moment.")
            if (err instanceof sdk.SafeActionError && (err.reason.code === "reverted" || err.reason.code === "not-the-safe")) clearPendingCreation(plan.chainId)
            setStage({ kind: "mining", plan, display, hash, stuck: true })
        }
    }

    if (stage.kind === "done") {
        const link = explorerTx(net.key, stage.hash)
        return (
            <div className="os-stack">
                <h3 className="os-h">Safe created</h3>
                <p className="os-sub">Checked on {label}: the Safe at this address has exactly the owners and threshold you chose.</p>
                <Full display={stage.display} />
                <div className="os-row">
                    <button type="button" className="os-btn" onClick={() => open(specForTarget({ kind: "multisig", address: stage.address })!)}>Open Safe</button>
                    {link && <a className="os-btn os-quiet" href={link} target="_blank" rel="noreferrer">Transaction</a>}
                </div>
            </div>
        )
    }

    if (stage.kind === "review" || stage.kind === "wallet" || stage.kind === "mining") {
        const { plan, display } = stage
        const link = stage.kind === "mining" ? explorerTx(net.key, stage.hash) : null
        return (
            <div className="os-stack">
                <h3 className="os-h">Review the new Safe</h3>
                <dl className="os-stack os-tight">
                    <dt className="os-sub">Address it will have on {label}</dt><dd><Full display={display[plan.predicted] ?? plan.predicted} /></dd>
                    <dt className="os-sub">Owners</dt><dd><ul className="os-list">{plan.owners.map((o) => <li key={o}><Full display={display[o] ?? o} />{o === wallet && <span className="os-pill">You</span>}</li>)}</ul></dd>
                    <dt className="os-sub">Signatures needed</dt><dd>{plan.threshold} of {plan.owners.length}</dd>
                    <dt className="os-sub">Contract</dt><dd>Safe v1.5.0 (L2), no modules</dd>
                </dl>
                <p className="os-sub">Your wallet sends one transaction and pays its gas. Owners can be changed later only by a transaction the Safe's owners sign.</p>
                {error && <p className="os-note os-err" role="alert">{error}</p>}
                {stage.kind === "wallet" && <p className="os-sub" role="status">Confirm the transaction in your wallet…</p>}
                {stage.kind === "mining" && <p className="os-sub" role="status">{stage.stuck ? "Sent." : "Creating the Safe…"}{link && <> <a href={link} target="_blank" rel="noreferrer">Transaction</a></>}</p>}
                {stage.kind === "mining" && stage.stuck
                    ? <div className="os-row">
                        <button type="button" className="os-btn" onClick={() => { void checkAgain() }}>Check again</button>
                        <button type="button" className="os-btn os-quiet" onClick={() => { clearPendingCreation(stage.plan.chainId); setError(null); setStage({ kind: "edit" }) }}>Start a new Safe</button>
                    </div>
                    : <div className="os-row">
                        <button type="button" className="os-btn" disabled={stage.kind !== "review"} onClick={() => { void create() }}>Create Safe</button>
                        <button type="button" className="os-btn os-quiet" disabled={stage.kind !== "review"} onClick={() => { setError(null); setStage({ kind: "edit" }) }}>Edit</button>
                    </div>}
            </div>
        )
    }

    return (
        <form className="os-stack" onSubmit={(e) => { void review(e) }}>
            <h3 className="os-h">New Safe on {label}</h3>
            <p className="os-sub">A Safe holds funds that leave only when enough of its owners sign. Add each owner's address, then choose how many signatures a transaction needs.</p>
            <fieldset className="os-stack os-tight">
                <legend className="os-sub">Owners</legend>
                {owners.map((o, i) => (
                    <div key={i} className="os-row">
                        <input className="os-in os-mono" aria-label={`Owner ${i + 1} address`} placeholder="0x…" value={o} onChange={(e) => setOwner(i, e.target.value)} autoComplete="off" spellCheck={false} />
                        {owners.length > 1 && <button type="button" className="os-btn os-quiet" aria-label={`Remove owner ${i + 1}`} onClick={() => removeOwner(i)}>Remove</button>}
                    </div>
                ))}
                {owners.length < MAX_OWNERS && <div className="os-row"><button type="button" className="os-btn os-quiet" onClick={() => setOwners((o) => [...o, ""])}>Add an owner</button></div>}
            </fieldset>
            <label className="os-row">
                <span className="os-sub">Signatures needed</span>
                <select className="os-in" aria-label="Signatures needed" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
                    {owners.map((_, i) => <option key={i} value={i + 1}>{i + 1} of {owners.length}</option>)}
                </select>
            </label>
            {error && <p className="os-note os-err" role="alert">{error}</p>}
            <div className="os-row">
                <button type="submit" className="os-btn" disabled={stage.kind === "planning"}>{stage.kind === "planning" ? "Preparing…" : wallet ? "Review" : "Connect a wallet to review"}</button>
            </div>
        </form>
    )
}
