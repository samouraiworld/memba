/**
 * Small status marks: `Pill` (the mockup's .pill, a one- or two-word status
 * such as "Live", "key needed", "Not on gnoland-1 yet") and `Gate` (the
 * mockup's slim .gate bar: why an action is off, plus what unlocks it).
 *
 * @module os/kit/Pill
 */
import type { ReactNode } from "react"

export type PillTone = "ok" | "warn" | "err" | "neutral"

export function Pill({ tone, children }: { tone?: PillTone; children: ReactNode }) {
    return <span className={tone ? `os-pill os-${tone}` : "os-pill"}>{children}</span>
}

export function Gate({ text, action }: { text: ReactNode; action?: ReactNode }) {
    return (
        <div className="os-gate os-gatebar">
            <span>{text}</span>
            {action}
        </div>
    )
}
