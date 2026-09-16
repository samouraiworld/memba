import { useRef, useState, useSyncExternalStore } from "react"
import { useParams, useOutletContext } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { MagnifyingGlass } from "@phosphor-icons/react"
import { api } from "../lib/api"
import { parseMsgs, parseFee } from "../lib/parseMsgs"
import { StatusBadge } from "../components/ui/StatusBadge"
import { getTxStatus } from "../components/ui/txStatus"
import { SkeletonCard, SkeletonRow } from "../components/ui/LoadingSkeleton"
import { ErrorToast } from "../components/ui/ErrorToast"
import { ProgressBar } from "../components/multisig/ProgressBar"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import type { Transaction } from "../gen/memba/v1/memba_pb"
import { API_BASE_URL, GNO_CHAIN_ID } from "../lib/config"
import { completeQuest } from "../lib/quests"
import type { LayoutContext } from "../types/layout"
import "./txview.css"
import { isNativeMultisig } from "../lib/nativeMultisig"
import { assertNativeAction, broadcastNativeTransaction } from "../lib/nativeMultisigBroadcast"
import { assertReceiptStorage, clearNativeReceipt, nativeReceiptKey, readNativeReceipt, saveNativeReceipt, subscribeNativeReceipts, validReceiptHash } from "../lib/nativeReceipt"

const LEGACY_READ_ONLY_MESSAGE = "Legacy multisig records are read-only history: this proposal cannot be broadcast or completed from Memba."

/** Build deterministic Amino sign doc from transaction data. */
function buildSignDoc(tx: Transaction): Record<string, unknown> {
    return {
        account_number: String(tx.accountNumber),
        chain_id: tx.chainId,
        fee: JSON.parse(tx.feeJson),
        memo: tx.memo || "",
        msgs: JSON.parse(tx.msgsJson),
        sequence: String(tx.sequence),
    }
}

export function TransactionView() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNetworkNav()
    const { adena, auth } = useOutletContext<LayoutContext>()
    const token = auth.token

    // Server state (the transaction itself) lives in React Query, keyed by tx
    // id AND auth token — switching wallets must refetch, not serve the other
    // wallet's view from cache. Disabled until both exist, which keeps the
    // skeleton up exactly like the old early-return did.
    const txQuery = useQuery({
        queryKey: ["multisig", "tx", GNO_CHAIN_ID, id ?? "", token?.userAddress ?? ""],
        enabled: !!token && !!id,
        queryFn: async () => {
            const res = await api.getTransaction({
                authToken: token!,
                transactionId: Number(id),
            })
            if (!res.transaction) throw new Error("Transaction not found")
            return res
        },
    })
    const tx = txQuery.data?.transaction ?? null
    const loading = txQuery.isPending
    const native = !!tx && isNativeMultisig(tx.multisigPubkeyJson)
    const receiptKey = tx && native ? nativeReceiptKey(tx, token?.userAddress ?? adena.address ?? "", API_BASE_URL) : ""
    const receipt = useSyncExternalStore(subscribeNativeReceipts, () => readNativeReceipt(receiptKey), () => "")
    const [recoveryWarning, setRecoveryWarning] = useState("")
    const broadcastBusy = useRef(false)
    const parsedMsgs = tx ? parseMsgs(tx.msgsJson) : []
    const fee = parseFee(tx?.feeJson ?? "")
    const reviewError = parsedMsgs.find(msg => msg.reviewError)?.reviewError || fee.reviewError

    // Action errors (sign / broadcast / manual sig) are UI state and stay
    // local; the fetch error comes from the query, with a dismissal flag so
    // the toast doesn't resurrect itself on the next render.
    const [actionError, setActionError] = useState<string | null>(null)
    const [fetchErrorDismissed, setFetchErrorDismissed] = useState(false)
    const fetchError = txQuery.isError && !fetchErrorDismissed
        ? (txQuery.error instanceof Error ? txQuery.error.message : "Failed to load transaction")
        : null
    const error = actionError ?? fetchError
    const dismissError = () => { setActionError(null); setFetchErrorDismissed(true) }

    const [actionLoading, setActionLoading] = useState(false)
    const [manualSig, setManualSig] = useState("")
    const [showManualSig, setShowManualSig] = useState(false)
    const [linkCopied, setLinkCopied] = useState(false)
    // W2.4 (multisig confirmation rigor): sign/broadcast are two-step — the
    // button opens a review card (full recipients, fee, network match,
    // irreversibility warning); only its Confirm runs the action.
    const [pendingAction, setPendingAction] = useState<"sign" | "broadcast" | null>(null)

    const handleSign = async () => {
        if (!token || !tx || actionLoading || reviewError || receipt) return
        setActionLoading(true)
        setActionError(null)
        try {
            if (isNativeMultisig(tx.multisigPubkeyJson)) assertNativeAction(tx.chainId)
            const signDoc = JSON.stringify(buildSignDoc(tx))
            const signDocBytes = new TextEncoder().encode(signDoc)

            const signature = await adena.signArbitrary(signDoc)
            if (!signature) {
                setActionError("Signature rejected")
                setActionLoading(false)
                return
            }

            await api.signTransaction({
                authToken: token,
                transactionId: tx.id,
                signature,
                bodyBytes: signDocBytes,
            })

            await txQuery.refetch()
        } catch (err) {
            setActionError(err instanceof Error ? err.message : "Failed to sign")
        } finally {
            setActionLoading(false)
        }
    }

    const handleBroadcast = async () => {
        if (!token || !tx || actionLoading || broadcastBusy.current) return
        broadcastBusy.current = true
        setActionLoading(true)
        setActionError(null)
        try {
            if (isNativeMultisig(tx.multisigPubkeyJson)) {
                assertNativeAction(tx.chainId)
                const fresh = await api.getTransaction({ authToken: token, transactionId: tx.id })
                if (!fresh.transaction || nativeReceiptKey(fresh.transaction, token.userAddress ?? adena.address ?? "", API_BASE_URL) !== receiptKey) throw new Error("Transaction identity changed; reload and review again")
                // A completion response may have been lost. Read the server's
                // state first; completed rows reject another Complete RPC.
                if (fresh.transaction.finalHash) {
                    const refreshed = await txQuery.refetch()
                    if (refreshed.data?.transaction?.finalHash) clearNativeReceipt(receiptKey)
                    return
                }
                let hash = readNativeReceipt(receiptKey)
                if (hash && !validReceiptHash(hash)) throw new Error("Recovery record is unavailable or invalid. Inspect it before any further broadcast")
                if (!hash) {
                    if (reviewError) throw new Error(reviewError)
                    if (!fresh.nativeTxBytes.length) throw new Error(fresh.nativeExportError || "Native aggregate is not ready")
                    assertReceiptStorage(receiptKey)
                    hash = await broadcastNativeTransaction(tx.chainId, fresh.nativeTxBytes)
                    if (!saveNativeReceipt(receiptKey, hash)) setRecoveryWarning("Browser storage failed after broadcast. Copy the hash before leaving this tab; receipt retry is still available here.")
                }
                await api.completeTransaction({ authToken: token, transactionId: tx.id, finalHash: hash })
                const refreshed = await txQuery.refetch()
                // Keep the hint if refresh fails or remains stale: never turn
                // a successful broadcast back into a broadcast-ready button.
                if (refreshed.data?.transaction?.finalHash) clearNativeReceipt(receiptKey)
                return
            }
            // Legacy (non-native) records are read-only history: their addresses
            // cannot execute on Gno and the backend refuses to complete them.
            throw new Error(LEGACY_READ_ONLY_MESSAGE)
        } catch (err) {
            setActionError(err instanceof Error ? err.message : "Broadcast failed")
        } finally {
            broadcastBusy.current = false
            setActionLoading(false)
        }
    }

    const formatDate = (dateStr: string) => {
        try {
            return new Date(dateStr).toLocaleDateString("en-US", {
                year: "numeric", month: "short", day: "numeric",
                hour: "2-digit", minute: "2-digit",
            })
        } catch { return dateStr }
    }

    // ── Loading state ─────────────────────────────────────────
    if (loading) {
        return (
            <div className="animate-fade-in k-txview">
                <button className="k-txview__back" onClick={() => navigate(-1)}>← Back</button>
                <SkeletonCard />
                <SkeletonCard />
                <div className="k-card k-txview__table-card">
                    <SkeletonRow />
                    <SkeletonRow />
                    <SkeletonRow />
                </div>
            </div>
        )
    }

    // ── Error state ───────────────────────────────────────────
    if (!tx) {
        return (
            <div className="animate-fade-in k-txview">
                <button className="k-txview__back" onClick={() => navigate(-1)}>← Back</button>
                <div className="k-dashed k-txview__not-found">
                    <span className="k-txview__not-found-icon"><MagnifyingGlass size={32} /></span>
                    <h3 className="k-txview__not-found-title">Transaction not found</h3>
                    <p className="k-txview__not-found-desc">
                        {auth.isAuthenticated ? `TX #${id} not found or you're not a member of its multisig.` : "Connect your wallet to view transaction details."}
                    </p>
                </div>
                <ErrorToast message={error} onDismiss={dismissError} />
            </div>
        )
    }

    // ── Parse data ────────────────────────────────────────────
    const nativeReady = !!txQuery.data?.nativeTxBytes?.length
    const status = getTxStatus(tx.finalHash, native && !nativeReady ? 0 : tx.signatures.length, tx.threshold)

    return (
        <div className="animate-fade-in k-txview">
            {/* ── Header ───────────────────────────────────────── */}
            <div>
                <button className="k-txview__back" onClick={() => navigate(-1)}>← Back</button>
                <div className="k-txview__header-row">
                    <div className="k-txview__title-row">
                        <h2 className="k-txview__title">TX #{id}</h2>
                        <StatusBadge status={status} sigCount={tx.signatures.length} threshold={tx.threshold} />
                        <button
                            className={`k-txview__share-btn ${linkCopied ? "k-txview__share-btn--copied" : ""}`}
                            onClick={() => {
                                navigator.clipboard.writeText(window.location.href)
                                completeQuest("share-link")
                                setLinkCopied(true)
                                setTimeout(() => setLinkCopied(false), 2000)
                            }}
                        >
                            {linkCopied ? "✓ Link Copied" : "Share"}
                        </button>
                    </div>
                    <p className="k-txview__meta">
                        {(tx.type || "send").toUpperCase()} • Created by <CopyableAddress address={tx.creatorAddress} full={false} fontSize={12} /> • {formatDate(tx.createdAt)}
                    </p>
                </div>
            </div>

            {/* ── Transaction Content ──────────────────────────── */}
            {parsedMsgs.map((msg, i) => (
                <div key={i} className="k-card k-txview__msg-card">
                    <div className="k-txview__msg-header">
                        <span className="k-txview__msg-type">{msg.type}</span>
                        <span className="k-txview__msg-label">{msg.label}</span>
                    </div>
                    {msg.fields.map((field, j) => (
                        <div key={j} className="k-txview__field-row">
                            <span className="k-label k-txview__field-key">{field.key}</span>
                            <span className={[
                                "k-txview__field-value",
                                field.accent ? "k-txview__field-value--accent" : "",
                                field.key === "Raw" ? "k-txview__field-value--raw" : "",
                            ].filter(Boolean).join(" ")}>
                                {field.value}
                            </span>
                        </div>
                    ))}
                </div>
            ))}

            {/* ── Details card ─────────────────────────────────── */}
            <div className="k-card k-txview__detail-card">
                <DetailRow label="Multisig" value={<CopyableAddress address={tx.multisigAddress} fontSize={13} />} />
                <DetailRow label="Chain" value={tx.chainId} />
                <DetailRow label="Memo" value={tx.memo || "—"} />
                <DetailRow label="Fee" value={fee.amount !== "—" ? `${fee.amount} (gas: ${fee.gas})` : `Gas: ${fee.gas}`} />
                <DetailRow label="Account #" value={String(tx.accountNumber)} />
                <DetailRow label="Sequence" value={String(tx.sequence)} />
            </div>

            {/* ── Signature Progress ──────────────────────────── */}
            <div>
                <h3 className="k-txview__section-title">Signature Progress</h3>
                <ProgressBar
                    current={tx.signatures.length}
                    verified={tx.signatures.filter(s => s.verified).length}
                    threshold={tx.threshold}
                    total={tx.membersCount}
                />
            </div>

            {/* ── Signers ─────────────────────────────────────── */}
            <div>
                <h3 className="k-txview__section-title">Signers</h3>
                <div className="k-card k-txview__table-card">
                    <div className="k-txview__table-header">
                        <span>Address</span>
                        <span>Status</span>
                    </div>
                    {tx.signatures.length === 0 ? (
                        <div className="k-txview__empty">
                            <p className="k-txview__empty-text">No signatures yet</p>
                        </div>
                    ) : (
                        tx.signatures.map((sig, i) => (
                            <div key={i} className="k-txview__signer-row">
                                <CopyableAddress address={sig.userAddress} fontSize={12} />
                                <span
                                    className={sig.verified
                                        ? "k-txview__signed-badge"
                                        : "k-txview__signed-badge k-txview__signed-badge--unverified"}
                                    title={sig.verified
                                        ? "The server re-derived this signature from the stored transaction and it checked out."
                                        : "Stored but not cryptographically verified — this signature either predates server-side verification (older transactions can never be re-checked) or did not match. Expected for legacy transactions; verification is advisory until enforcement is switched on."}
                                >
                                    {sig.verified ? "Verified" : "Unverified"}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* ── Actions ─────────────────────────────────────── */}
            {reviewError && <p role="alert">{reviewError}</p>}
            {native && receipt && !tx.finalHash && <div className="k-card" role="status">
                <p>Broadcast receipt recovery — this saved hash is not proof of completion. The backend must verify it on-chain.</p>
                <code style={{ overflowWrap: "anywhere" }}>{validReceiptHash(receipt) ? receipt : "Recovery record is unavailable or invalid; inspect it before continuing."}</code>
                {recoveryWarning && <p role="alert">{recoveryWarning}</p>}
                <p>Retry only saves the verified receipt. It does not broadcast again.</p>
                <button className="k-btn-primary" disabled={actionLoading || !auth.isAuthenticated || !validReceiptHash(receipt)} onClick={() => void handleBroadcast()}>
                    {actionLoading ? "Checking receipt..." : "Retry receipt verification"}
                </button>
            </div>}
            {native && txQuery.data?.nativeExportError && <p role="status">{txQuery.data.nativeExportError}</p>}
            {!native && !tx.finalHash && <p role="status">{LEGACY_READ_ONLY_MESSAGE}</p>}
            {!tx.finalHash && auth.isAuthenticated && (
                <div className="k-txview__actions">
                    <button
                        className="k-btn-primary"
                        disabled={actionLoading || !!reviewError || !!receipt || tx.signatures.some(s => s.userAddress === adena.address)}
                        onClick={() => setPendingAction("sign")}
                        style={{ opacity: actionLoading ? 0.5 : 1 }}
                    >
                        {actionLoading ? "Signing..." : tx.signatures.some(s => s.userAddress === adena.address) ? "Already Signed" : "Sign Transaction"}
                    </button>
                    {native && nativeReady && !receipt && (
                        <button
                            className="k-btn-primary"
                            style={{ background: "var(--color-k-accent-hover)", opacity: actionLoading ? 0.5 : 1 }}
                            disabled={actionLoading || !!reviewError}
                            onClick={() => setPendingAction("broadcast")}
                        >
                            {actionLoading ? "Broadcasting..." : "Broadcast to Chain"}
                        </button>
                    )}
                    <button
                        className="k-btn-secondary"
                        onClick={() => {
                            const json = native ? JSON.stringify({ msg: JSON.parse(tx.msgsJson), fee: JSON.parse(tx.feeJson), signatures: null, memo: tx.memo || "" }, null, 2) : JSON.stringify(buildSignDoc(tx), null, 2)
                            const blob = new Blob([json], { type: "application/json" })
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement("a")
                            a.href = url
                            a.download = `memba-tx-${tx.id}-unsigned.json`
                            a.click()
                            URL.revokeObjectURL(url)
                        }}
                    >
                        Export Unsigned TX
                    </button>
                    {nativeReady && <button className="k-btn-secondary" onClick={() => {
                        const blob = new Blob([txQuery.data!.nativeTxJson], { type: "application/json" })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement("a"); a.href = url; a.download = `memba-tx-${tx.id}-native-signed.json`; a.click(); URL.revokeObjectURL(url)
                    }}>Export Native Signed TX</button>}
                    <button
                        className="k-btn-secondary"
                        onClick={() => setShowManualSig(!showManualSig)}
                    >
                        {showManualSig ? "Hide" : "Paste gnokey Sig"}
                    </button>
                </div>
            )}

            {/* ── W2.4: Review card — confirm before sign/broadcast ── */}
            {pendingAction && !tx.finalHash && (
                <div className="k-card k-txview__confirm-card" role="alertdialog" aria-label="Review transaction" style={{
                    border: "1px solid var(--color-k-amber-border)",
                    display: "flex", flexDirection: "column", gap: 12, padding: 18,
                }}>
                    <h3 style={{ fontSize: "var(--pro-body, 14px)", fontWeight: 700, margin: 0 }}>
                        Review before you {pendingAction === "sign" ? "sign" : "broadcast"}
                    </h3>
                    {parseMsgs(tx.msgsJson, { full: true }).map((msg, i) => (
                        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <span style={{ fontSize: "var(--pro-small, 12px)", fontWeight: 600 }}>{msg.label}</span>
                            {msg.fields.map((field, j) => (
                                <div key={j} style={{ display: "flex", gap: 8, fontSize: "var(--pro-small, 12px)" }}>
                                    <span className="k-label" style={{ minWidth: 90 }}>{field.key}</span>
                                    <span style={{ fontFamily: "var(--font-ui, JetBrains Mono, monospace)", wordBreak: "break-all" }}>{field.value}</span>
                                </div>
                            ))}
                        </div>
                    ))}
                    <div style={{ display: "flex", gap: 8, fontSize: "var(--pro-small, 12px)" }}>
                        <span className="k-label" style={{ minWidth: 90 }}>Fee</span>
                        <span>{fee.amount !== "—" ? `${fee.amount} (gas: ${fee.gas})` : `Gas: ${fee.gas}`}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, fontSize: "var(--pro-small, 12px)", alignItems: "center" }}>
                        <span className="k-label" style={{ minWidth: 90 }}>Network</span>
                        {tx.chainId === GNO_CHAIN_ID ? (
                            <span style={{ color: "var(--color-success, #2fbf71)" }}>✓ {tx.chainId} — matches this app's network</span>
                        ) : (
                            <span style={{ color: "var(--color-danger)" }}>
                                ⚠ {tx.chainId} — DIFFERENT from this app's network ({GNO_CHAIN_ID})
                            </span>
                        )}
                    </div>
                    <p style={{ fontSize: "var(--pro-caption, 11px)", color: "var(--color-text-secondary)", margin: 0 }}>
                        {pendingAction === "sign"
                            ? "Your signature authorizes this exact transaction. Verify the full recipient address character by character."
                            : "Broadcasting is an on-chain action that costs gas and cannot be undone."}
                    </p>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button className="k-btn-secondary" onClick={() => setPendingAction(null)}>Cancel</button>
                        <button
                            className="k-btn-primary"
                            disabled={actionLoading || !!reviewError || !!receipt}
                            onClick={() => {
                                const action = pendingAction
                                setPendingAction(null)
                                if (action === "sign") void handleSign()
                                else void handleBroadcast()
                            }}
                        >
                            Confirm {pendingAction === "sign" ? "& Sign" : "& Broadcast"}
                        </button>
                    </div>
                </div>
            )}

            {/* ── Manual Signature Paste (air-gapped flow) ────── */}
            {showManualSig && !tx.finalHash && auth.isAuthenticated && (
                <div className="k-card k-txview__manual-form">
                    <p className="k-label">Paste gnokey Signature</p>
                    <p className="k-txview__manual-desc">
                        Export the unsigned TX above, sign with gnokey offline, then paste the base64 signature here.
                    </p>
                    <input
                        className="k-txview__manual-input"
                        type="text"
                        value={manualSig}
                        onChange={(e) => setManualSig(e.target.value)}
                        placeholder="Paste base64 signature from gnokey..."
                    />
                    <button
                        className="k-btn-primary"
                        disabled={!manualSig.trim() || actionLoading || !!reviewError || !!receipt}
                        style={{ opacity: manualSig.trim() && !actionLoading ? 1 : 0.5, alignSelf: "flex-start" }}
                        onClick={async () => {
                            if (!token || !tx || !manualSig.trim() || reviewError || receipt) return
                            setActionLoading(true)
                            setActionError(null)
                            try {
                                if (isNativeMultisig(tx.multisigPubkeyJson)) assertNativeAction(tx.chainId)
                                const signDoc = JSON.stringify(buildSignDoc(tx))
                                await api.signTransaction({
                                    authToken: token,
                                    transactionId: tx.id,
                                    signature: manualSig.trim(),
                                    bodyBytes: new TextEncoder().encode(signDoc),
                                })
                                setManualSig("")
                                setShowManualSig(false)
                                await txQuery.refetch()
                            } catch (err) {
                                setActionError(err instanceof Error ? err.message : "Failed to submit signature")
                            } finally {
                                setActionLoading(false)
                            }
                        }}
                    >
                        {actionLoading ? "Submitting..." : "Submit Signature"}
                    </button>
                </div>
            )}

            {/* ── Final Hash ──────────────────────────────────── */}
            {tx.finalHash && (
                <div className="k-card k-txview__hash-card">
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <p className="k-label k-txview__hash-label" style={{ margin: 0 }}>Transaction Hash</p>
                        {/* Native: verified means the backend matched the chain
                            receipt to this proposal. Legacy rows may carry
                            verified=true from an older lookup that only found
                            the hash somewhere, so they never claim more. */}
                        {tx.verified && !native ? (
                            <span style={{
                                fontSize: "var(--pro-caption, 10px)", padding: "2px 8px", borderRadius: 4,
                                background: "var(--color-k-amber-subtle, rgba(255,193,7,0.12))", color: "var(--color-text-secondary)",
                                fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
                            }} title="Legacy multisig record: this hash was recorded without being checked against this transaction's contents.">Hash recorded (not verified against this transaction)</span>
                        ) : tx.verified ? (
                            <span style={{
                                fontSize: "var(--pro-caption, 10px)", padding: "2px 8px", borderRadius: 4,
                                background: "rgba(47,191,113,0.12)", color: "var(--color-success, #2fbf71)",
                                fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
                            }}>✓ VERIFIED ON-CHAIN</span>
                        ) : (
                            <span style={{
                                fontSize: "var(--pro-caption, 10px)", padding: "2px 8px", borderRadius: 4,
                                background: "var(--color-k-amber-subtle, rgba(255,193,7,0.12))", color: "var(--color-k-warning, #ffc107)",
                                fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
                            }} title="The backend could not confirm this hash on-chain at completion time — it is a client-reported value.">⏳ UNCONFIRMED</span>
                        )}
                    </div>
                    <p className="k-txview__hash-value">
                        {tx.finalHash}
                    </p>
                </div>
            )}

            <ErrorToast message={error} onDismiss={dismissError} />
        </div>
    )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="k-txview__detail-row">
            <span className="k-label">{label}</span>
            <span className="k-txview__detail-value">{value}</span>
        </div>
    )
}
