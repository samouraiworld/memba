/**
 * ReportAppButton — the App Store community safety valve (B1b).
 *
 * One on-chain report per account per listing; at the realm's hide threshold the
 * listing drops from the public lists until a curator clears the reports. The
 * confirm step states that, and the deposit a report locks, before any wallet
 * prompt. Disconnected visitors get connect-on-action (the PostCard flag
 * pattern) instead of a dead button.
 */
import { useState } from "react"
import { useAdena } from "../../hooks/useAdena"
import { appFlagStorageBytes, FLAG_HIDE_THRESHOLD, NothingSentError, submitAppReport } from "../../lib/appStore"
import { formatUgnot, STORAGE_PRICE_UGNOT } from "../../lib/dao/v2Budget"

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
            await submitAppReport(address, pkgPath)
            setDone(true)
            setConfirming(false)
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (/denied|rejected|cancel/i.test(msg)) {
                setError(null) // wallet dismissal is not an error to shout about
            } else {
                // Checks made before the wallet say what stopped them; anything else is generic.
                setError(e instanceof NothingSentError ? msg : "The report did not go through. A transaction that fails on chain still costs its network fee.")
            }
        } finally {
            setBusy(false)
        }
    }

    if (done) {
        return (
            <span className="appreport appreport--done" data-testid="appreport-done">
                Reported. Your report is recorded on the listing.
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
                        Reporting is on-chain and public: one report per account, and it
                        can't be withdrawn. It pays a storage deposit of about{" "}
                        {formatUgnot(appFlagStorageBytes(pkgPath) * STORAGE_PRICE_UGNOT)} that is not returned,
                        plus the network fee. Reports from {FLAG_HIDE_THRESHOLD} different accounts hide
                        the listing from the public lists until a curator clears them.
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
