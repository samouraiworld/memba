/** On-chain ratings and reviews for one storefront subject: list, composer, and review actions through the OS signer. */
import { useEffect, useRef, useState } from "react"
import { isAppReviewsAvailable } from "../../../lib/config"
import type { ReviewAct } from "../../../components/reviews/ReviewCard"
import { ReviewsSection } from "../../../components/reviews/ReviewsSection"
import { MIN_RATED_COUNT } from "../../../components/reviews/AppReviewStars"
import { networkGasPriceFresh } from "../../../lib/grc20"
import type { OsSession } from "../../shell/useOsSession"
import { useAlive } from "../../shell/useAlive"
import { useSigner } from "../../sign/signerContext"
import { NativeReviewComposer } from "./NativeReviewComposer"
import { reviewActionRequest } from "./reviewActionRequest"

export function ReviewsPanel({ subject, name, session, composable, onRefresh }: { subject: string; name: string; session: OsSession; composable: boolean; onRefresh?: () => void }) {
    const signer = useSigner()
    const [refresh, setRefresh] = useState(0)
    // False once this window is gone, and the list a fee quote was asked from: a quote that returns late opens no sheet.
    const alive = useAlive()
    const listShown = useRef(refresh)
    useEffect(() => { listShown.current = refresh }, [refresh])
    if (!isAppReviewsAvailable()) return <p className="os-cin-sub">Onchain reviews are not available here yet.</p>
    // An action on a review opens the signing sheet and hands over: the list reloads when the chain has it.
    const act: ReviewAct = async (action) => {
        if (session.status !== "member") { session.openConnect(); return false }
        const from = listShown.current
        // Read from the chain at this click: a cached or fallback price would be refused at the recheck.
        const price = await networkGasPriceFresh().catch(() => { throw new Error("The network fee could not be read. Try again in a moment.") })
        if (!alive.current || listShown.current !== from) return false
        signer.sign(reviewActionRequest({
            action, appName: name, caller: session.address, networkKey: session.network.key, chainId: session.network.chainId, price,
            onSettled: (outcome) => { if (outcome === "confirmed" || outcome === "submitted") setRefresh((value) => value + 1) },
        }))
        return false
    }
    return <div className="os-store-reviews">
        {composable && <NativeReviewComposer key={subject} session={session} subject={subject} appName={name} onSubmitted={() => setRefresh((value) => value + 1)} />}
        <ReviewsSection key={`${subject}:${refresh}`} subject={subject} minRatedCount={MIN_RATED_COUNT} paginate useOnchainSummary os={{ viewer: session.status === "member" ? session.address : null, act }} />
        <div className="os-store-review-actions"><button type="button" className="os-btn os-quiet" onClick={() => { setRefresh((value) => value + 1); onRefresh?.() }}>Refresh reviews</button></div>
    </div>
}
