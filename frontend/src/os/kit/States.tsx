/**
 * The three OS states apps reach for while data loads, comes back empty, or
 * fails: `Loading`, `Empty`, `ErrorState`.
 *
 * @module os/kit/States
 */
import type { ReactNode } from "react"

export function Loading({ label = "Loading…" }: { label?: string }) {
    return (
        <div className="os-row" role="status">
            <span className="os-spin" aria-hidden="true" />
            <span className="os-sub">{label}</span>
        </div>
    )
}

export function Empty({ title, action }: { title: string; action?: ReactNode }) {
    return (
        <div className="os-empty">
            <p className="os-sub">{title}</p>
            {action}
        </div>
    )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="os-note os-err os-row" role="alert">
            <span>{message}</span>
            <button type="button" className="os-btn os-quiet" onClick={onRetry}>Retry</button>
        </div>
    )
}
