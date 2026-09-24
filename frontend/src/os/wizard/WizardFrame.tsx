/**
 * The wizard window frame (D18): a step bar, the form, a live preview, and a
 * footer with Back / Next. Content and rules belong to each wizard; drafts are
 * saved by the wizard as the member types.
 *
 * @module os/wizard/WizardFrame
 */
import type { ReactNode } from "react"

export function WizardFrame({ steps, step, children, preview, note, onBack, onNext, nextLabel, nextDisabled }: {
    steps: readonly string[]
    step: number
    children: ReactNode
    preview?: ReactNode
    note?: ReactNode
    onBack?: () => void
    onNext?: () => void
    nextLabel: string
    nextDisabled?: boolean
}) {
    return (
        <div className="os-wiz">
            <ol className="os-wiz-steps" aria-label="Steps">
                {steps.map((s, i) => (
                    <li key={s} aria-current={i === step ? "step" : undefined} className={i < step ? "os-done" : undefined}>
                        <span className="os-wiz-dot" aria-hidden="true">{i < step ? "✓" : i + 1}</span>{s}
                    </li>
                ))}
            </ol>
            <div className="os-wiz-main">
                <div className="os-wiz-form">{children}</div>
                {preview && <aside className="os-wiz-preview" aria-label="Preview">{preview}</aside>}
            </div>
            <div className="os-wiz-foot">
                <span className="os-sub os-grow">{note}</span>
                {onBack && step > 0 && <button type="button" className="os-btn os-quiet" onClick={onBack}>Back</button>}
                {onNext && <button type="button" className="os-btn" onClick={onNext} disabled={nextDisabled}>{nextLabel}</button>}
            </div>
        </div>
    )
}

/** A labelled form field with a hint, an error, and an optional character count. */
export function Field({ label, htmlFor, hint, error, count, children }: {
    label: string
    htmlFor?: string
    hint?: string
    error?: string
    count?: string
    children: ReactNode
}) {
    return (
        <div className="os-fl">
            <span className="os-fll os-row os-between">
                {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
                {count && <span className="os-sub">{count}</span>}
            </span>
            {children}
            {error ? <span className="os-fe" role="alert">{error}</span> : hint ? <span className="os-fh">{hint}</span> : null}
        </div>
    )
}
