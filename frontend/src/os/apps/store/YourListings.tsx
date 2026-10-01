import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchMyListings, type AppListing } from "../../../lib/appStore"
import { assertDelistApplies, MAX_RESUBMITS } from "../../../lib/appStoreSubmit"
import { networkGasPriceFresh } from "../../../lib/grc20"
import { ErrorState, Loading, Pill } from "../../kit"
import type { NativeViewProps } from "../../native/types"
import { specForTarget } from "../../shell/windows"
import { useSigner } from "../../sign/signerContext"
import { useAlive } from "../../shell/useAlive"
import { listingRequest } from "./listingRequest"

/** The connected wallet's own listings, in every status, with edit and delist through the signing sheet. */
export function YourListings({ session, push }: Pick<NativeViewProps, "session" | "push">) {
    const signer = useSigner()
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState<string | null>(null)
    const alive = useAlive()
    const member = session.status === "member"
    const mine = useQuery({
        queryKey: ["appStore", "native-mine", session.network.chainId, member ? session.address : null],
        queryFn: () => fetchMyListings(session.address), enabled: member, staleTime: 30_000, retry: 1,
    })
    const to = (section: string, query?: string) => push(specForTarget({ kind: "app", app: "store", section, query })!)

    const delist = async (listing: AppListing) => {
        setBusy(listing.pkgPath)
        setError(null)
        try {
            await assertDelistApplies(session.address, listing.pkgPath)
            const price = await networkGasPriceFresh().catch(() => { throw new Error("The network fee could not be read. Try again in a moment.") })
            if (!alive.current) return
            signer.sign(listingRequest({
                action: { kind: "delist", pkgPath: listing.pkgPath, name: listing.name },
                caller: session.address, networkKey: session.network.key, chainId: session.network.chainId, price,
                onSettled: (outcome) => { if (outcome === "confirmed" || outcome === "submitted") void mine.refetch() },
            }))
        } catch (cause) {
            if (alive.current) setError(cause instanceof Error ? cause.message : "Could not prepare the delist.")
        } finally {
            if (alive.current) setBusy(null)
        }
    }

    return <div className="os-store-home">
        <header className="os-store-section-head">
            <p className="os-store-kicker">APP STORE</p>
            <h1>Your listings</h1>
            <p>Listings this wallet published, in every status. <button type="button" className="os-btn os-quiet" onClick={() => to("submit")}>Submit an app</button></p>
        </header>
        {session.status === "resuming" && <Loading label="Restoring your session…" />}
        {session.status === "guest" && <div className="os-store-notice" role="status"><p>Connect the wallet that published your listings to see them here.</p><button type="button" className="os-btn" onClick={session.openConnect}>Connect</button></div>}
        {member && mine.isPending && <Loading label="Reading your listings…" />}
        {member && mine.isError && <ErrorState message="Your listings could not be read from the registry." onRetry={() => void mine.refetch()} />}
        {error && <p className="os-store-review-error" role="alert">{error}</p>}
        {mine.data && mine.data.unshown > 0 && <p className="os-store-notice" role="status">{mine.data.unshown} {mine.data.unshown === 1 ? "listing" : "listings"} of this wallet cannot be shown here: {mine.data.unshown === 1 ? "its package path is" : "their package paths are"} outside what Memba displays.</p>}
        {mine.data && (mine.data.listings.length === 0
            ? mine.data.unshown === 0 && <p className="os-store-empty">This wallet has not published a listing yet.</p>
            : <ul className="os-store-queue">{mine.data.listings.map((listing) => {
                const used = listing.resubmitCount
                const editable = (listing.status === "pending" || listing.status === "rejected") && used !== undefined && used < MAX_RESUBMITS
                return <li key={listing.pkgPath}>
                    <span className="os-store-mine-head"><b>{listing.name}</b> <Pill tone={listing.status === "live" ? "ok" : listing.status === "rejected" ? "warn" : "neutral"}>{listing.status}</Pill></span>
                    <code>{listing.pkgPath}</code>
                    {listing.rejectReason && <span>Curator's reason: {listing.rejectReason}</span>}
                    <span>Reports: {listing.flagCount}{used !== undefined && ` · Edits used: ${used} of ${MAX_RESUBMITS}`}</span>
                    <span className="os-store-mine-actions">
                        {editable && <button type="button" className="os-btn os-quiet" onClick={() => to("submit", `edit=${encodeURIComponent(listing.pkgPath)}`)}>Edit</button>}
                        {listing.status !== "delisted" && <button type="button" className="os-btn os-quiet" disabled={busy !== null} onClick={() => void delist(listing)}>{busy === listing.pkgPath ? "Checking…" : "Delist"}</button>}
                    </span>
                </li>
            })}</ul>)}
        {mine.data && !mine.data.complete && <p className="os-store-notice" role="status">Showing the first {mine.data.listings.length} listings.</p>}
    </div>
}
