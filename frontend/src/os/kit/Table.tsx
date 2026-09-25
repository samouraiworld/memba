/**
 * The mockup's data table (table.t): tabular numbers, uppercase headers, an
 * optional click/Enter handler per row.
 *
 * @module os/kit/Table
 */
import type { ReactNode } from "react"

export interface Column<T> {
    key: string
    label: string
    align?: "start" | "end"
    render: (row: T) => ReactNode
}

export function Table<T>({ columns, rows, rowKey, onRowClick, empty }: {
    columns: readonly Column<T>[]
    rows: readonly T[]
    rowKey: (row: T) => string
    onRowClick?: (row: T) => void
    empty: ReactNode
}) {
    if (rows.length === 0) return <p className="os-sub">{empty}</p>
    return (
        <div className="os-tw">
            <table className="os-t">
                <thead>
                    <tr>{columns.map((c) => <th key={c.key} data-align={c.align}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr
                            key={rowKey(r)}
                            className={onRowClick ? "os-click" : undefined}
                            tabIndex={onRowClick ? 0 : undefined}
                            onClick={onRowClick ? () => onRowClick(r) : undefined}
                            onKeyDown={onRowClick ? (e) => { if (e.key === "Enter") onRowClick(r) } : undefined}
                        >
                            {columns.map((c) => <td key={c.key} data-align={c.align}>{c.render(r)}</td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
