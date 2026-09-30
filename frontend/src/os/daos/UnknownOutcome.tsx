/**
 * The lock a DAO action keeps after an attempt whose outcome is unknown (the
 * wallet opened and Memba cannot tell whether the transaction went out). It
 * stays until the member says they checked the transaction.
 *
 * @module os/daos/UnknownOutcome
 */
import { useState } from "react"
import { clearGovernanceReceipt, type GovernanceReceipt, type GovernanceScope } from "../../lib/dao/governanceRecovery"

const WORDS = { vote: { noun: "vote", again: "voting again" }, execution: { noun: "execution", again: "executing again" } } as const

export function UnknownOutcome({ scope, receipt, attempt, onCleared }: { scope: GovernanceScope; receipt: GovernanceReceipt; attempt: keyof typeof WORDS; onCleared: () => void }) {
    const [checked, setChecked] = useState(false)
    const { noun, again } = WORDS[attempt]
    return (
        <div className="os-note os-warn os-stack os-tight" role="status">
            <b>Outcome unknown.</b>
            <span>A previous {noun} attempt is saved. Check its outcome before {again}.</span>
            {receipt.hash && <code className="os-mono os-break">Transaction {receipt.hash}</code>}
            <label className="os-ack"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I checked the transaction and want to review this {noun} again.</label>
            <button type="button" className="os-btn os-quiet" disabled={!checked} onClick={() => {
                try { clearGovernanceReceipt(scope); onCleared() } catch { /* a request is still in flight */ }
            }}>Review the {noun} again</button>
        </div>
    )
}
