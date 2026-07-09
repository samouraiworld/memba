/**
 * ReportAppButton — the App Store community safety valve (B1b).
 *
 * One on-chain flag per address per listing; at the realm's hide threshold the
 * listing drops from the public lists for curator review. The confirm step
 * discloses exactly that (an on-chain, public, one-shot action) before any
 * wallet prompt. Disconnected visitors get connect-on-action (the PostCard
 * flag pattern) instead of a dead button.
 */
import { useState } from "react"
import { useAdena } from "../../hooks/useAdena"
import { buildFlagAppMsg } from "../../lib/appStore"

export function ReportAppButton({ pkgPath }: { pkgPath: string }) {
    const { connected, address, connect } = useAdena()
    const [confirming, setConfirming] = useState(false)
    const [busy, setBusy] = useState(false)
    const [done, setDone] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const submit = async () => {
        setBusy(true)
        setError(null)
        try {
            const { doContractBroadcast } = await import("../../lib/grc20")
            await doContractBroadcast([buildFlagAppMsg(address, pkgPath)], "Report app")
            setDone(true)
            setConfirming(false)
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (/already flagged/i.test(msg)) {
                // The realm's dedupe: this address reported it before — that IS the end state.
                setDone(true)
                setConfirming(false)
            } else if (/denied|rejected|cancel/i.test(msg)) {
                setError(null) // wallet dismissal is not an error to shout about
            } else {
                setError("Could not submit the report. Please try again.")
            }
        } finally {
            setBusy(false)
        }
    }

    if (done) {
        return (
            <span className="appreport appreport--done" data-testid="appreport-done">
                Reported — a curator will review this listing.
            </span>
        )
    }

    return (
        <span className="appreport">
            {!confirming ? (
                <button
                    type="button"
                    className="appbtn appbtn--ghost appreport__btn"
                    data-testid="appreport-btn"
                    onClick={() => {
                        if (!connected) {
                            void connect()
                            return
                        }
                        setConfirming(true)
                    }}
                >
                    Report app
                </button>
            ) : (
                <span className="appreport__confirm" data-testid="appreport-confirm">
                    <span className="appreport__copy">
                        Reporting is on-chain and public — one report per address, and it
                        can't be withdrawn. Enough reports hide the listing pending curator
                        review.
                    </span>
                    <button type="button" className="appbtn appbtn--ghost" disabled={busy}
                        data-testid="appreport-yes" onClick={() => void submit()}>
                        {busy ? "Reporting…" : "Report it"}
                    </button>
                    <button type="button" className="appbtn appbtn--ghost" disabled={busy}
                        data-testid="appreport-cancel" onClick={() => { setConfirming(false); setError(null) }}>
                        Cancel
                    </button>
                </span>
            )}
            {error && <span className="appreport__error" role="alert" data-testid="appreport-error">{error}</span>}
        </span>
    )
}
