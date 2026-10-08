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
 * `VITE_ENABLE_APPSTORE` (AppStoreGate) and requires a v3 or v4 realm + a curator wallet.
 *
 * @module pages/AppCurator
 */

import { useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useAdena } from "../hooks/useAdena"
import { useNetwork } from "../hooks/useNetwork"
import { isAppStoreV3OrLater, isAppStoreV4, isPublishablePath, isSafeRealmPath, fetchByStatus, type AppListing } from "../lib/appStore"
import { walletErrorText } from "../lib/walletErrorText"
import {
    MAX_REASON_LEN,
    fetchIsCurator,
    buildApproveAppMsg,
    buildRejectAppMsg,
    buildAttestPublisherMsg,
    buildRevokeAttestationMsg,
} from "../lib/appStoreCuration"
import { isValidGnoAddressChecksum } from "../lib/dao/address"
import "./appstore.css"

export function AppCurator() {
    const { networkKey } = useNetwork()
    const { connected, address, connect } = useAdena()
    const v3 = isAppStoreV3OrLater()

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
                    <p className="appstore__notice-title">Curation needs App Store v3 or later</p>
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

            {isAppStoreV4() && <AttestPanel address={address} />}

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

    // A mutation's options reach it in an effect after each render, so a click landing before that
    // effect would run an earlier render's mutationFn (a reason without its last keystroke): the
    // verdict, the account, the listing and the reason travel with the call.
    const act = useMutation({
        mutationFn: async ({ kind, caller, pkgPath, reason }: { kind: "approve" | "reject"; caller: string; pkgPath: string; reason: string }) => {
            const { doContractBroadcast } = await import("../lib/grc20")
            const msg = kind === "approve" ? buildApproveAppMsg(caller, pkgPath) : buildRejectAppMsg(caller, pkgPath, reason)
            return doContractBroadcast([msg], kind === "approve" ? "Approve app" : "Reject app")
        },
        onSuccess: removeFromQueue,
        onError: (e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e)
            if (/only a pending app|unauthorized/i.test(msg)) {
                // The realm's verdict is the truth — refresh rather than argue with it.
                setError("The realm refused the action — the listing may have changed. Reload the queue.")
            } else {
                setError(walletErrorText(e, "The transaction didn't go through. Please try again.") || null)
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
                    onClick={() => { setError(null); act.mutate({ kind: "approve", caller: address, pkgPath: listing.pkgPath, reason: "" }) }}>
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
                            onClick={() => { setError(null); act.mutate({ kind: "reject", caller: address, pkgPath: listing.pkgPath, reason: reason.trim() }) }}>
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

/**
 * v4 registers a path only for its namespace owner, or for an address a curator attested for it:
 * attest a publisher whose namespace owner cannot sign, or withdraw an unused attestation.
 */
function AttestPanel({ address }: { address: string }) {
    const [pkgPath, setPkgPath] = useState("")
    const [publisher, setPublisher] = useState("")
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
    // Attesting needs a path v4 publishes; withdrawing only a safe one (the realm says when there is none).
    const attestPathOk = isPublishablePath(pkgPath)
    const revokePathOk = isSafeRealmPath(pkgPath)
    const publisherOk = isValidGnoAddressChecksum(publisher)
    // The account, the path and the publisher travel with the call (see QueueItem).
    const act = useMutation({
        mutationFn: async ({ kind, caller, pkgPath, publisher }: { kind: "attest" | "revoke"; caller: string; pkgPath: string; publisher: string }) => {
            const { doContractBroadcast } = await import("../lib/grc20")
            const msg = kind === "attest" ? buildAttestPublisherMsg(caller, pkgPath, publisher) : buildRevokeAttestationMsg(caller, pkgPath)
            await doContractBroadcast([msg], kind === "attest" ? "Attest publisher" : "Revoke attestation")
            return kind
        },
        onSuccess: (kind, { pkgPath, publisher }) => setResult({ ok: true, text: kind === "attest"
            ? `Sent: once the chain includes it, ${publisher} can list ${pkgPath} once.`
            : `Sent: once the chain includes it, the attestation for ${pkgPath} is withdrawn.` }),
        onError: (e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e)
            if (/denied|rejected by user|cancel/i.test(msg)) setResult(null)
            else if (/already registered/i.test(msg)) setResult({ ok: false, text: "This path is already listed: an attestation only opens an unlisted path." })
            else if (/no attestation/i.test(msg)) setResult({ ok: false, text: "This path has no attestation to withdraw." })
            else setResult({ ok: false, text: "The transaction didn't go through. Please try again." })
        },
    })
    const send = (kind: "attest" | "revoke") => { setResult(null); act.mutate({ kind, caller: address, pkgPath, publisher }) }
    return (
        <section className="appcurator__rejectbox" data-testid="appcurator-attest">
            <p className="appstore__notice-title">Attest a publisher</p>
            <p className="appstore__muted">
                Only the owner of a path's namespace can list it. To let another address list one path once,
                attest it here; withdraw an attestation that has not been used yet.
            </p>
            <label htmlFor="appcurator-attest-path">Package path</label>
            <input id="appcurator-attest-path" value={pkgPath} placeholder="gno.land/r/…" onChange={(e) => setPkgPath(e.target.value.trim())} />
            <label htmlFor="appcurator-attest-publisher">Publisher address</label>
            <input id="appcurator-attest-publisher" value={publisher} placeholder="g1…" onChange={(e) => setPublisher(e.target.value.trim())} />
            <div className="appcurator__actions">
                <button type="button" className="appbtn appbtn--primary" disabled={act.isPending || !attestPathOk || !publisherOk} onClick={() => send("attest")}>
                    {act.isPending ? "Waiting for wallet…" : "Attest"}
                </button>
                <button type="button" className="appbtn appbtn--ghost" disabled={act.isPending || !revokePathOk} onClick={() => send("revoke")}>
                    Withdraw attestation
                </button>
            </div>
            {result && <p className={result.ok ? "appstore__muted" : "appsubmit__txerror"} role={result.ok ? "status" : "alert"}>{result.text}</p>}
        </section>
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
