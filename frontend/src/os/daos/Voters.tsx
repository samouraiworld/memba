import type { ReactNode } from "react"

/** One voter as the chain records them: who, what they chose, and what their vote weighs. */
export interface VoterRow {
    address: string
    /** The DAO's or the registry's name for them, when there is one. */
    name: string | null
    choice: string
    weight: string
}

/**
 * Who voted what on a proposal, read from the chain; guests read it too. A
 * failed first read says so instead of showing an empty list; a failed re-read
 * keeps the previous one and says that.
 */
export function Voters({ rows, error, none, children }: { rows: VoterRow[] | undefined; error: boolean; none?: string; children?: ReactNode }) {
    return (
        <section>
            <h3 className="os-h">Votes</h3>
            {rows === undefined
                ? error ? <p className="os-sub">Who voted couldn't be read right now.</p> : <p className="os-sub" role="status">Reading the votes…</p>
                : rows.length === 0 ? none && <p className="os-sub">{none}</p>
                    : <ul className="os-list">{rows.map((r) => (
                        <li key={r.address} className="os-it os-top">
                            <span className="os-grow">
                                {r.name && <b>{r.name}</b>}
                                <span className={`os-mono os-break ${r.name ? "os-sub os-block" : ""}`}>{r.address}</span>
                            </span>
                            <span className="os-right">{r.choice}<span className="os-sub os-block">{r.weight}</span></span>
                        </li>
                    ))}</ul>}
            {rows !== undefined && error && <p className="os-sub">Showing the last read: the votes couldn't be read again just now.</p>}
            {children}
        </section>
    )
}
