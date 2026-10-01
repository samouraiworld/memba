import { useEffect, useRef, useState, type FormEvent } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ListingFields } from "../../../components/appstore/ListingFields"
import { useAuth } from "../../../hooks/useAuth"
import { fetchAppStrict, fetchRegistryState, isSafeRealmPath, type AppListing } from "../../../lib/appStore"
import {
    assertEditApplies, assertRegisterApplies, formatGnot, listingToSubmission, registerStorageBytes, validateSubmission, type AppSubmission,
} from "../../../lib/appStoreSubmit"
import { formatUgnot, STORAGE_PRICE_UGNOT } from "../../../lib/dao/v2Budget"
import { networkGasPriceFresh } from "../../../lib/grc20"
import { ErrorState, Loading } from "../../kit"
import type { NativeViewProps } from "../../native/types"
import { specForTarget } from "../../shell/windows"
import { useSigner } from "../../sign/signerContext"
import { listingRequest, type ListingAction } from "./listingRequest"
import "../../../pages/appstore.css"

const EMPTY: AppSubmission = { pkgPath: "", name: "", tagline: "", descr: "", category: "", iconCID: "", screenshotsCSV: "", appURL: "" }

type Props = Pick<NativeViewProps, "session" | "query" | "push">

/** Submit a listing, or resubmit one (`?edit=<package path>`), through the signing sheet. Guests fill it in and connect to send. */
export function SubmitListing({ session, query, push }: Props) {
    const editPath = new URLSearchParams(query ?? "").get("edit")
    // An edit overwrites every field, so it starts from the listing's full record on the chain, never a list row.
    const loaded = useQuery({
        queryKey: ["appStore", "native-edit", session.network.chainId, editPath],
        queryFn: () => fetchAppStrict(editPath!), enabled: !!editPath && isSafeRealmPath(editPath), staleTime: 0, retry: 1,
    })
    if (!editPath) return <ListingForm session={session} push={push} listing={null} />
    if (loaded.isPending && isSafeRealmPath(editPath)) return <Loading label="Loading the listing…" />
    if (loaded.isError) return <ErrorState message="The listing could not be read from the registry." onRetry={() => void loaded.refetch()} />
    const listing = loaded.data
    if (!listing || listing.publisher !== session.address) {
        return <p className="os-store-notice" role="status">{session.status === "member" ? "This listing is not one of yours, or it no longer exists." : "Connect the wallet that published this listing to edit it."}</p>
    }
    return <ListingForm key={`${listing.pkgPath}:${listing.resubmitCount}`} session={session} push={push} listing={listing} />
}

function ListingForm({ session, push, listing }: Omit<Props, "query"> & { listing: AppListing | null }) {
    const editPath = listing?.pkgPath ?? null
    const was = listing ? listingToSubmission(listing) : null
    const auth = useAuth()
    const signer = useSigner()
    const [form, setForm] = useState<AppSubmission>(was ?? EMPTY)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    // "confirmed": the chain shows it; "submitted": sent, not seen on chain yet.
    const [sent, setSent] = useState<"confirmed" | "submitted" | null>(null)
    const queryClient = useQueryClient()
    const alive = useRef(true)
    useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
    const registry = useQuery({
        queryKey: ["appStore", "native-registry", session.network.chainId],
        queryFn: fetchRegistryState, enabled: !editPath, staleTime: 30_000, retry: 1,
    })

    const mine = () => push(specForTarget({ kind: "app", app: "store", section: "my-submissions" })!)
    if (sent) {
        return <div className="os-store-notice" role="status">
            <p>{sent === "confirmed"
                ? `${editPath ? "Resubmitted: the listing is pending review again." : "Submitted: the listing is pending review."} It is not in the approved catalogue until a curator approves it.`
                : "Sent; not visible on chain yet. Your listings shows it once the chain has it."}</p>
            <button type="button" className="os-btn" onClick={mine}>Your listings</button>
        </div>
    }

    const errors = validateSubmission(form)
    const ready = form.pkgPath !== "" && form.name !== "" && Object.keys(errors).length === 0
    const state = registry.data
    const submit = async (event: FormEvent) => {
        event.preventDefault()
        if (session.status === "resuming") return
        if (session.status !== "member") { session.openConnect(); return }
        if (!ready) return
        setBusy(true)
        setError(null)
        try {
            const submission = { ...form }
            let action: ListingAction
            if (was && listing) {
                await assertEditApplies(session.address, submission, was)
                action = { kind: "edit", submission, was, editsUsed: listing.resubmitCount ?? 0 }
            } else {
                if (!state) throw new Error("The listing fee could not be read. Nothing was sent.")
                await assertRegisterApplies(submission, state.registrationFee)
                action = { kind: "register", submission, feeUgnot: state.registrationFee }
            }
            const price = await networkGasPriceFresh().catch(() => { throw new Error("The network fee could not be read. Try again in a moment.") })
            if (!alive.current) return
            signer.sign(listingRequest({
                action, caller: session.address, networkKey: session.network.key, chainId: session.network.chainId, price,
                onSettled: (outcome) => {
                    if (outcome !== "confirmed" && outcome !== "submitted") return
                    void queryClient.invalidateQueries({ queryKey: ["appStore", "native-mine"] })
                    if (alive.current) setSent(outcome)
                },
            }))
        } catch (cause) {
            if (alive.current) setError(cause instanceof Error ? cause.message : "Could not prepare this listing.")
        } finally {
            if (alive.current) setBusy(false)
        }
    }

    return <form className="os-store-home appsubmit__form" onSubmit={(event) => void submit(event)}>
        <header className="os-store-section-head">
            <p className="os-store-kicker">APP STORE</p>
            <h1>{editPath ? `Edit ${listing?.name}` : "Submit an app"}</h1>
            <p>{editPath
                ? "Editing sends the listing back to pending review. It costs no listing fee, only the network fee and a small deposit for anything it adds."
                : "A listing starts as pending review and joins the catalogue when a curator approves it."}</p>
        </header>
        <ListingFields form={form} setForm={setForm} errors={errors} authed={auth.isAuthenticated} pkgPathDisabled={!!editPath} />
        {!editPath && (state
            ? state.paused
                ? <p className="os-store-notice" role="alert">The App Store is paused: new listings are closed for now.</p>
                : <p className="os-store-notice" role="note">Listing fee: {formatGnot(state.registrationFee)} GNOT, forwarded to the App Store treasury and not returned, including if the listing is rejected. The listing also pays a storage deposit of about {formatUgnot(registerStorageBytes(form) * STORAGE_PRICE_UGNOT)} that is not returned, and the transaction costs a network fee.</p>
            : registry.isError
                ? <ErrorState message="The listing fee could not be read from the registry." onRetry={() => void registry.refetch()} />
                : <Loading label="Reading the listing fee…" />)}
        {error && <p className="os-store-review-error" role="alert">{error}</p>}
        <button type="submit" className="os-btn" disabled={busy || (session.status === "member" && (!ready || (!editPath && (!state || state.paused))))}>
            {session.status === "resuming" ? "Restoring your session…" : session.status !== "member" ? "Connect to submit" : busy ? "Checking the listing…" : editPath ? "Resubmit for review" : "Submit for review"}
        </button>
    </form>
}
