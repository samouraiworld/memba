/**
 * AppCurator — the curator review queue at `/apps/review` (B4).
 *
 * Curators (the samcrew multisig signers, on-chain `curators` set) work through pending
 * submissions: Approve flips a listing live (Verified), Reject records a reason the
 * submitter sees in My Submissions and grants their free resubmit credit. The `IsCurator`
 * check here is UX ONLY — the realm panics on a non-curator caller no matter what this
 * page renders — and it fails closed on any read problem.
 *
 * Curation moves no funds, so there is no safety-gated flag: the route rides
 * `VITE_ENABLE_APPSTORE` (AppStoreGate) and requires the v3 realm + a curator wallet.
 *
 * @module pages/AppCurator
 */

import { useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useAdena } from "../hooks/useAdena"
import { useNetwork } from "../hooks/useNetwork"
import { isAppStoreV3, fetchByStatus, type AppListing } from "../lib/appStore"
import {
    MAX_REASON_LEN,
    fetchIsCurator,
    buildApproveAppMsg,
    buildRejectAppMsg,
} from "../lib/appStoreCuration"
import "./appstore.css"

export function AppCurator() {
    const { networkKey } = useNetwork()
    const { connected, address, connect } = useAdena()
    const v3 = isAppStoreV3()

    const { data: isCurator } = useQuery({
        queryKey: ["appStore", "isCurator", address],
        queryFn: () => fetchIsCurator(address),
        enabled: v3 && connected && !!address,
        staleTime: 300_000,
        retry: 1,
    })

    if (!v3) {
        return (
            <Shell networkKey={networkKey}>
                <div className="appstore__notice" data-testid="appcurator-v2">
                    <p className="appstore__notice-title">Curation needs the v3 App Store realm</p>
                    <p className="appstore__muted">
                        This network is still on the previous App Store realm. Check back after the
                        migration.
                    </p>
                </div>
            </Shell>
        )
    }
    if (!connected) {
        return (
            <Shell networkKey={networkKey}>
                <div className="appstore__notice">
                    <p className="appstore__notice-title">Connect your curator wallet</p>
                    <p className="appstore__muted">
                        Approving or rejecting a submission is an on-chain action restricted to the
                        realm's curator set.
                    </p>
                    <button type="button" className="appbtn appbtn--primary" onClick={() => void connect()}>
                        Connect wallet
                    </button>
                </div>
            </Shell>
        )
    }
    if (isCurator === undefined) {
        return (
            <Shell networkKey={networkKey}>
                <p className="appstore__muted">Checking curator access…</p>
            </Shell>
        )
    }
    if (!isCurator) {
        return (
            <Shell networkKey={networkKey}>
                <div className="appstore__notice" data-testid="appcurator-denied">
                    <p className="appstore__notice-title">Curator access only</p>
                    <p className="appstore__muted">
                        This wallet isn't in the realm's curator set. (The realm enforces this
                        on-chain regardless of what any page shows.)
                    </p>
                </div>
            </Shell>
        )
    }
    return <CuratorQueue networkKey={networkKey} address={address} />
}

function CuratorQueue({ networkKey, address }: { networkKey: string; address: string }) {
    const { data: queue, isPending, isError } = useQuery({
        queryKey: ["appStore", "curatorQueue"],
        queryFn: () => fetchByStatus("pending", 0, 50),
        staleTime: 30_000,
        retry: 1,
    })

    return (
        <Shell networkKey={networkKey}>
            <header className="appstore__masthead appsubmit__masthead">
                <p className="appstore__eyebrow">Curator dashboard</p>
                <h1 className="appstore__headline">Review queue</h1>
                <p className="appstore__lede">
                    Approving makes a listing <strong>Verified</strong> — you're vouching that its
                    identity and realm path check out (not that it's audited). Read the source
                    before approving; give rejected submitters a reason they can act on.
                </p>
            </header>

            {isPending ? (
                <p className="appstore__muted">Loading the queue…</p>
            ) : isError ? (
                <div className="appstore__notice">
                    <p className="appstore__notice-title">Couldn't load the queue</p>
                    <p className="appstore__muted">The realm didn't respond. Reload to retry.</p>
                </div>
            ) : !queue || queue.length === 0 ? (
                <div className="appstore__notice">
                    <p className="appstore__notice-title">The queue is clear</p>
                    <p className="appstore__muted">No submissions are waiting for review.</p>
                </div>
            ) : (
                <ul className="appsubmit__minelist">
                    {queue.map((l) => (
                        <QueueItem key={l.pkgPath} listing={l} networkKey={networkKey} address={address} />
                    ))}
                </ul>
            )}
        </Shell>
    )
}

function QueueItem({ listing, networkKey, address }: {
    listing: AppListing
    networkKey: string
    address: string
}) {
    const qc = useQueryClient()
    const [rejecting, setRejecting] = useState(false)
    const [reason, setReason] = useState("")
    const [error, setError] = useState<string | null>(null)
    const rel = listing.pkgPath.replace(/^gno\.land\//, "")

    const removeFromQueue = () => {
        qc.setQueryData<AppListing[]>(["appStore", "curatorQueue"], (prev) =>
            (prev ?? []).filter((x) => x.pkgPath !== listing.pkgPath))
        // Both verdicts change what the store's public surfaces show.
        void qc.invalidateQueries({ queryKey: ["appStore", "live"] })
        void qc.invalidateQueries({ queryKey: ["appStore", "pending"] })
    }

    const act = useMutation({
        mutationFn: async (kind: "approve" | "reject") => {
            const { doContractBroadcast } = await import("../lib/grc20")
            const msg = kind === "approve"
                ? buildApproveAppMsg(address, listing.pkgPath)
                : buildRejectAppMsg(address, listing.pkgPath, reason.trim())
            return doContractBroadcast([msg], kind === "approve" ? "Approve app" : "Reject app")
        },
        onSuccess: removeFromQueue,
        onError: (e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e)
            if (/denied|rejected by user|cancel/i.test(msg)) {
                setError(null) // wallet dismissal
            } else if (/only a pending app|unauthorized/i.test(msg)) {
                // The realm's verdict is the truth — refresh rather than argue with it.
                setError("The realm refused the action — the listing may have changed. Reload the queue.")
            } else {
                setError("The transaction didn't go through. Please try again.")
            }
        },
    })

    return (
        <li className="appsubmit__mineitem" data-testid="appcurator-item">
            <div className="appsubmit__minehead">
                <span className="appsubmit__minename">{listing.name}</span>
                {listing.category && <span className="appchip">{listing.category}</span>}
            </div>
            {listing.tagline && <p className="appstore__muted appcurator__tagline">{listing.tagline}</p>}
            <code className="apppath">{listing.pkgPath}</code>
            <p className="appcurator__meta">
                Publisher <code className="apptrust__addr">{listing.publisher}</code>
                {listing.flagCount > 0 && (
                    <span className="appcurator__flags"> · {listing.flagCount} community report{listing.flagCount === 1 ? "" : "s"}</span>
                )}
            </p>
            <div className="appcurator__actions">
                <Link className="appbtn appbtn--ghost" to={`/${networkKey}/directory?tab=explorer&realm=${rel}`}>
                    Read the source
                </Link>
                <Link className="appbtn appbtn--ghost" to={`/${networkKey}/apps/${rel}`}>
                    Preview listing
                </Link>
                <button type="button" className="appbtn appbtn--primary" disabled={act.isPending}
                    onClick={() => { setError(null); act.mutate("approve") }}>
                    {act.isPending ? "Waiting for wallet…" : "Approve"}
                </button>
                {!rejecting && (
                    <button type="button" className="appbtn appbtn--ghost" disabled={act.isPending}
                        onClick={() => setRejecting(true)}>
                        Reject…
                    </button>
                )}
            </div>
            {rejecting && (
                <div className="appcurator__rejectbox">
                    <label htmlFor={`appcurator-reason-${listing.id}`}>Reason (shown to the submitter)</label>
                    <textarea
                        id={`appcurator-reason-${listing.id}`} rows={3} value={reason}
                        maxLength={MAX_REASON_LEN}
                        placeholder="What must change before this can be approved?"
                        onChange={(e) => setReason(e.target.value)}
                    />
                    <div className="appcurator__actions">
                        <button type="button" className="appbtn appbtn--primary"
                            data-testid="appcurator-reject-confirm"
                            disabled={act.isPending || reason.trim() === ""}
                            onClick={() => { setError(null); act.mutate("reject") }}>
                            {act.isPending ? "Waiting for wallet…" : "Reject with reason"}
                        </button>
                        <button type="button" className="appbtn appbtn--ghost" disabled={act.isPending}
                            onClick={() => { setRejecting(false); setReason(""); setError(null) }}>
                            Cancel
                        </button>
                    </div>
                </div>
            )}
            {error && <p className="appsubmit__txerror" role="alert">{error}</p>}
        </li>
    )
}

function Shell({ networkKey, children }: { networkKey: string; children: React.ReactNode }) {
    return (
        <div className="appstore appcurator" data-testid="appcurator-root">
            <Link className="appstore__back" to={`/${networkKey}/apps`}>← All apps</Link>
            {children}
        </div>
    )
}
