/**
 * Timing of one wallet flow (connect, sign-in): each step is a performance
 * mark + measure from the flow's start ("memba:wallet:<flow>:<label>"), visible
 * in a Performance panel recording and cleared when the flow ends (so they
 * never pile up), and a "timing" line in the opt-in wallet
 * log (walletDebug), so a slow report can say which Adena call took the time.
 */
import { installWalletLogDump, logWalletEvent } from "./walletDebug"

export interface WalletFlow {
    /** Record that `label` happened now. */
    step(label: string): void
    /** Record the outcome; later steps are ignored. */
    end(outcome: string): void
}

const perf = (): Performance | null => (typeof performance !== "undefined" && typeof performance.mark === "function" ? performance : null)

let seq = 0

export function startWalletFlow(name: string): WalletFlow {
    installWalletLogDump()
    const prefix = `memba:wallet:${name}`
    // A unique start mark: two flows of the same name never measure from each other's start.
    const startMark = `${prefix}:start#${++seq}`
    const t0 = Date.now()
    try { perf()?.mark(startMark) } catch { /* timing is best effort */ }
    let done = false
    const marks: string[] = [startMark]
    const record = (label: string) => {
        const ms = Date.now() - t0
        try {
            const p = perf()
            if (p) {
                const mark = `${prefix}:${label}`
                p.mark(mark)
                p.measure(mark, startMark, mark)
                marks.push(mark)
            }
        } catch { /* timing is best effort */ }
        logWalletEvent("timing", `${name} ${label} +${ms}ms`)
    }
    return {
        step(label) { if (!done) record(label) },
        end(outcome) {
            if (done) return
            record(`end:${outcome}`)
            done = true
            // The log line holds the timing: the flow's entries would only pile up in the buffer.
            try {
                const p = perf()
                for (const m of marks) {
                    p?.clearMarks(m)
                    if (m !== startMark) p?.clearMeasures(m)
                }
            } catch { /* best effort */ }
        },
    }
}
