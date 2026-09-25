/**
 * The mockup's data table (table.t): tabular numbers, uppercase headers,
 * optional sorting, paging and a click handler per row.
 *
 * Opening a row: when `onRowClick` is set, the `openColumn` cell's content
 * (the first column by default) is a real `<button>` (`.os-t-open`) labelled
 * by `rowLabel` — that's the focusable, announced "open" control for
 * keyboard and AT users. The `<tr>`'s own `onClick` extends the same action to
 * a click anywhere else in the row, except on the row's own controls (a
 * button, link, field or label in another cell) and except while the user is
 * selecting text. The open button stops propagation so a click on it doesn't
 * also trigger the row's handler.
 *
 * Sorting: a column with `sort` gets a header button that cycles none →
 * ascending → descending → none (`aria-sort` on the `<th>`). Paging: with
 * `pageSize`, a pager shows "Showing x–y of n"; it goes back to page 1 when
 * the number of rows changes.
 *
 * @module os/kit/Table
 */
import { useState, type MouseEvent, type ReactNode } from "react"

export interface Column<T> {
    key: string
    label: string
    align?: "start" | "end"
    render: (row: T) => ReactNode
    /** Makes the header a sort button; compares two rows for ascending order. */
    sort?: (a: T, b: T) => number
}

type Direction = "ascending" | "descending"

/** Rows open only with a label for their open button: `onRowClick` and `rowLabel` come together. */
type RowOpening<T> =
    | { onRowClick?: undefined; rowLabel?: undefined }
    | {
        onRowClick: (row: T) => void
        /** The open button's accessible name, e.g. "Open proposal #12". */
        rowLabel: (row: T) => string
    }

export type TableProps<T> = {
    columns: readonly Column<T>[]
    rows: readonly T[]
    rowKey: (row: T) => string
    empty: ReactNode
    /** The column whose content becomes the open button (default: the first column). */
    openColumn?: string
    /** Rows per page; unset shows every row. */
    pageSize?: number
} & RowOpening<T>

/** A click on one of these inside a row is that control's, not the row's. */
const ROW_CONTROLS = "button, a, input, select, textarea, label"

export function Table<T>({ columns, rows, rowKey, empty, openColumn, pageSize, onRowClick, rowLabel }: TableProps<T>) {
    const [sort, setSort] = useState<{ key: string; dir: Direction } | null>(null)
    const [page, setPage] = useState(0)
    // Back to page 1 when the row count changes (adjusting state during render, not in an effect).
    const [rowCount, setRowCount] = useState(rows.length)
    if (rowCount !== rows.length) {
        setRowCount(rows.length)
        setPage(0)
    }

    if (rows.length === 0) return <div className="os-sub">{empty}</div>

    const compare = sort ? columns.find((c) => c.key === sort.key)?.sort : undefined
    const sorted = sort && compare ? [...rows].sort((a, b) => (sort.dir === "ascending" ? 1 : -1) * compare(a, b)) : rows
    const size = pageSize && pageSize > 0 ? pageSize : rows.length
    const pages = Math.max(1, Math.ceil(rows.length / size))
    const current = Math.min(page, pages - 1)
    const shown = sorted.slice(current * size, current * size + size)
    const openKey = openColumn ?? columns[0]?.key

    const cycle = (key: string) => {
        setSort((s) => (s?.key !== key ? { key, dir: "ascending" } : s.dir === "ascending" ? { key, dir: "descending" } : null))
        setPage(0)
    }
    const rowClick = (row: T) => (e: MouseEvent<HTMLTableRowElement>) => {
        const control = (e.target as Element).closest(ROW_CONTROLS)
        if (control && e.currentTarget.contains(control)) return
        if (window.getSelection()?.toString()) return
        onRowClick?.(row)
    }

    return (
        <div className="os-tw">
            <table className="os-t">
                <thead>
                    <tr>{columns.map((c) => {
                        if (!c.sort) return <th key={c.key} data-align={c.align}>{c.label}</th>
                        const dir = sort?.key === c.key ? sort.dir : "none"
                        return (
                            <th key={c.key} data-align={c.align} aria-sort={dir}>
                                <button type="button" className="os-t-sort" onClick={() => cycle(c.key)}>
                                    {c.label}
                                    <span aria-hidden="true" className="os-t-dir">{dir === "ascending" ? "↑" : dir === "descending" ? "↓" : ""}</span>
                                </button>
                            </th>
                        )
                    })}</tr>
                </thead>
                <tbody>
                    {shown.map((r) => (
                        <tr key={rowKey(r)} className={onRowClick ? "os-click" : undefined} onClick={onRowClick ? rowClick(r) : undefined}>
                            {columns.map((c) => (
                                <td key={c.key} data-align={c.align}>
                                    {onRowClick && c.key === openKey
                                        ? (
                                            <button type="button" className="os-t-open" aria-label={rowLabel?.(r)}
                                                onClick={(e) => { e.stopPropagation(); onRowClick(r) }}>
                                                {c.render(r)}
                                            </button>
                                        )
                                        : c.render(r)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
            {pageSize ? (
                <div className="os-t-pager">
                    <span className="os-sub">Showing {current * size + 1}–{current * size + shown.length} of {rows.length}</span>
                    <button type="button" className="os-btn os-quiet" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
                    <button type="button" className="os-btn os-quiet" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
                </div>
            ) : null}
        </div>
    )
}
