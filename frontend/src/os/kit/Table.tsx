/**
 * The mockup's data table (table.t): tabular numbers, uppercase headers, an
 * optional click handler per row. When `onRowClick` is set, the first
 * column's content is a real `<button>` (`.os-t-open`) — that's what gives
 * keyboard and AT users a focusable, announced "open" control; the `<tr>`'s
 * own `onClick` just extends the same action to a click anywhere else in the
 * row. The button stops propagation so a click on it doesn't also trigger
 * the row's handler.
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
                            onClick={onRowClick ? () => onRowClick(r) : undefined}
                        >
                            {columns.map((c, i) => (
                                <td key={c.key} data-align={c.align}>
                                    {onRowClick && i === 0
                                        ? <button type="button" className="os-t-open" onClick={(e) => { e.stopPropagation(); onRowClick(r) }}>{c.render(r)}</button>
                                        : c.render(r)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
