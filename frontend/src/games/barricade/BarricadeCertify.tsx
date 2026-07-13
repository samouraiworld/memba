/**
 * BarricadeCertify — the opt-in "certify this run on-chain" control on the daily
 * results poster. Rendered ONLY when VITE_ENABLE_BARRICADE_CERTIFY is on and the
 * run self-verified, so the wallet hooks it pulls in (useArcadeCertify) never
 * load on the no-wallet play path.
 */
import { useArcadeCertify } from "./hooks/useArcadeCertify"
import type { SimEvent } from "./sim/types"

export interface CertifyRun {
    seed: string
    simVersion: number
    events: SimEvent[]
    claimedScore: number
    claimedHash: string
}

export default function BarricadeCertify({ run }: { run: CertifyRun }) {
    const { certify, status, error } = useArcadeCertify()

    if (status === "certified") {
        return <p className="bar-hint bar-verified">Certified on-chain ✓ — it’ll appear on the day’s board once attested.</p>
    }

    return (
        <>
            <button
                className="k-btn-secondary"
                disabled={status === "certifying"}
                onClick={() =>
                    certify({
                        seed: run.seed,
                        simVersion: run.simVersion,
                        events: run.events,
                        claimedScore: run.claimedScore,
                        claimedHash: run.claimedHash,
                    })
                }
            >
                {status === "certifying" ? "Certifying…" : "Certify on-chain"}
            </button>
            {status === "error" && error && <p className="bar-hint bar-mismatch">{error}</p>}
        </>
    )
}
