/**
 * Draws the lines of a Safe transaction (./lineModel.ts): every call in full.
 *
 * @module os/multisig/evm/TxLines
 */
import { addressGroups } from "../../../lib/chain/evm/safe/recipients"
import type { LineView } from "./lineModel"

function Full({ value }: { value: string }) {
    return <span className="os-mono os-break" aria-label={value}>{addressGroups(value).join(" ")}</span>
}

export function TxLinesView({ lines, batch }: { lines: LineView[]; batch: boolean }) {
    return (
        <div className="os-stack os-tight">
            {batch && <p className="os-sub">A batch of {lines.length} calls, run together as one transaction: all or none.</p>}
            <ol className="os-list">{lines.map((l, i) => (
                <li key={i} className="os-stack os-tight">
                    <b>{batch ? `${i + 1}. ` : ""}{l.title}</b>
                    <dl className="os-stack os-tight">{l.rows.map((r, j) => (
                        <div key={j} className="os-row os-top"><dt className="os-sub">{r.label}</dt><dd className="os-grow">{r.address ? <Full value={r.value} /> : <span className={r.data ? "os-mono os-break os-sub" : undefined}>{r.value}</span>}</dd></div>
                    ))}</dl>
                    {l.notes.map((n, j) => <p key={j} className={`os-note ${n.severity === "danger" ? "os-err" : "os-warn"}`}>{n.text}</p>)}
                </li>
            ))}</ol>
        </div>
    )
}
