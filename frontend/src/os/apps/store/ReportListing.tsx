import { useState } from "react"
import { assertAppReportApplies, FLAG_HIDE_THRESHOLD, type AppListing } from "../../../lib/appStore"
import { networkGasPriceFresh } from "../../../lib/grc20"
import type { OsSession } from "../../shell/useOsSession"
import { useSigner } from "../../sign/signerContext"
import { useAlive } from "../../shell/useAlive"
import { reportRequest } from "./reportRequest"

/** Report a live or pending listing to the curators; guests are asked to connect when they press it. */
export function ReportListing({ session, listing, appName, onReported }: {
    session: OsSession
    listing: AppListing
    appName: string
    onReported: () => void
}) {
    const signer = useSigner()
    const [busy, setBusy] = useState(false)
    const [reported, setReported] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // False once this window is gone: a check that returns late opens no sheet.
    const alive = useAlive()

    const report = async () => {
        if (session.status !== "member") { session.openConnect(); return }
        setBusy(true)
        setError(null)
        try {
            // Checked before the sheet opens and again before the wallet: a second report fails after charging the fee.
            await assertAppReportApplies(session.address, listing.pkgPath)
            const price = await networkGasPriceFresh().catch(() => { throw new Error("The network fee could not be read. Try again in a moment.") })
            if (!alive.current) return
            signer.sign(reportRequest({
                pkgPath: listing.pkgPath, appName, caller: session.address,
                networkKey: session.network.key, chainId: session.network.chainId, price,
                onSettled: (outcome) => {
                    if (outcome !== "confirmed" && outcome !== "submitted") return
                    if (alive.current) setReported(true)
                    onReported()
                },
            }))
        } catch (cause) {
            if (alive.current) setError(cause instanceof Error ? cause.message : "Could not prepare this report.")
        } finally {
            if (alive.current) setBusy(false)
        }
    }

    return <section className="os-store-report" aria-label="Report this listing">
        <p>Reports so far: {listing.flagCount}. Reports from {FLAG_HIDE_THRESHOLD} different accounts hide a listing from the public lists until a curator clears them.</p>
        {reported
            ? <p role="status">You reported this listing.</p>
            : <button type="button" className="os-btn os-quiet" disabled={busy} onClick={() => void report()}>{busy ? "Checking the listing…" : "Report this listing"}</button>}
        {error && <p className="os-store-review-error" role="alert">{error}</p>}
    </section>
}
