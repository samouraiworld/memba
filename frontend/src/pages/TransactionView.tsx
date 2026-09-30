import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useParams, useOutletContext } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Code, ConnectError } from "@connectrpc/connect"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { MagnifyingGlass } from "@phosphor-icons/react"
import { api } from "../lib/api"
import { parseMsgs, parseFee, type ParsedField } from "../lib/parseMsgs"
import { SignedAddress, SignedArgs, SignedText } from "../components/ui/SigningValue"
import { StatusBadge } from "../components/ui/StatusBadge"
import { getMultisigStatus } from "../components/ui/txStatus"
import { SkeletonCard, SkeletonRow } from "../components/ui/LoadingSkeleton"
import { ErrorToast } from "../components/ui/ErrorToast"
import { ProgressBar } from "../components/multisig/ProgressBar"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import type { Token, Transaction } from "../gen/memba/v1/memba_pb"
import { API_BASE_URL, ENABLE_NATIVE_GNO_MULTISIG, GNO_CHAIN_ID } from "../lib/config"
import { completeQuest } from "../lib/quests"
import type { LayoutContext } from "../types/layout"
import "./txview.css"
import { isNativeMultisig } from "../lib/nativeMultisig"
import { assertNativeAction, broadcastNativeTransaction, NativeOutcomeUnknownError, nativeTxHash } from "../lib/nativeMultisigBroadcast"
import { assertReceiptStorage, clearNativeReceipt, nativeReceiptKey, readBroadcastAttempts, readNativeReceipt, saveBroadcastAttempt, saveNativeReceipt, subscribeNativeReceipts, validReceiptHash } from "../lib/nativeReceipt"

const LEGACY_READ_ONLY_MESSAGE = "Legacy multisig records are read-only history: this proposal cannot be signed or broadcast from Memba."

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

/**
 * The `tx/:id` route: one TransactionView per transaction. Navigating from
 * tx/7 to tx/12 reuses the route element, so without the key a signature
 * pasted, an error shown or a review opened for tx 7 would survive onto
 * tx 12 (and "Submit Signature" would file tx 7's signature under tx 12).
 */
export function TransactionRoute() {
    const { id } = useParams<{ id: string }>()
    return <TransactionView key={id} />
}

/**
 * Asks the backend to record `hash` for a proposal. It answers "recorded" only
 * after finding that transaction on chain (executed, or executed and refused:
 * the refreshed proposal then carries the chain's reason); "absent" when the
 * node answered that it is not there;
 * "completed" when the proposal already has its hash (another member was
 * faster); "unanswered" for anything else (rate limit, chain node unreachable):
 * that is not a "no".
 */
async function askWhetherOnChain(authToken: Token, transactionId: number, hash: string): Promise<"recorded" | "absent" | "completed" | "unanswered"> {
    try {
        await api.completeTransaction({ authToken, transactionId, finalHash: hash })
        return "recorded"
    } catch (err) {
        const code = ConnectError.from(err).code
        return code === Code.FailedPrecondition ? "absent" : code === Code.NotFound ? "completed" : "unanswered"
    }
}

export function TransactionView() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNetworkNav()
    const { adena, auth } = useOutletContext<LayoutContext>()
    const token = auth.token
    const queryClient = useQueryClient()

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
    // Full addresses everywhere: a shortened one hides the bytes a lookalike forges.
    const parsedMsgs = tx ? parseMsgs(tx.msgsJson, { full: true }) : []
    const fee = parseFee(tx?.feeJson ?? "")
    const unreviewable = parsedMsgs.length === 0 || parsedMsgs.some(msg => msg.fields.some(field => field.key === "Raw" || field.key === "Raw Data"))
    const reviewError = parsedMsgs.find(msg => msg.reviewError)?.reviewError || fee.reviewError
        || (unreviewable ? "Cannot safely review this message type. Inspect the unsigned transaction before signing." : undefined)
        || (tx && tx.chainId !== GNO_CHAIN_ID ? "This transaction is for a different network. Switch to its network before signing." : undefined)

    // Action errors (sign / broadcast / manual sig) are UI state and stay
    // local; the fetch error comes from the query, with a dismissal flag so
    // the toast doesn't resurrect itself on the next render.
    const [actionError, setActionError] = useState<string | null>(null)
    // Not a passing error: what the member must read before pressing Broadcast again (an unknown outcome and its hash,
    // an unreadable recovery record) stays on the page in full until they act.
    const [broadcastAlert, setBroadcastAlert] = useState("")
    const [fetchErrorDismissed, setFetchErrorDismissed] = useState(false)
    const fetchError = txQuery.isError && !fetchErrorDismissed
        ? (txQuery.error instanceof Error ? txQuery.error.message : "Failed to load transaction")
        : null
    const error = actionError ?? fetchError
    const dismissError = () => { setActionError(null); setFetchErrorDismissed(true) }

    const [actionLoading, setActionLoading] = useState(false)
    const [broadcastStep, setBroadcastStep] = useState<"asking" | "sending">("sending")
    const [actionNotice, setActionNotice] = useState("")
    const [manualSig, setManualSig] = useState("")
    const [showManualSig, setShowManualSig] = useState(false)
    const [linkCopied, setLinkCopied] = useState(false)
    // W2.4 (multisig confirmation rigor): sign/broadcast are two-step — the
    // button opens a review card (full recipients, fee, network match,
    // irreversibility warning); only its Confirm runs the action.
    const [pendingAction, setPendingAction] = useState<"sign" | "broadcast" | null>(null)
    const reviewRef = useRef<HTMLDivElement>(null)
    const reviewOpener = useRef<HTMLButtonElement | null>(null)
    const restoreReviewFocus = useRef(false)
    const refreshAccounts = () => queryClient.invalidateQueries({
        queryKey: ["multisig"],
        predicate: query => query.queryKey[1] !== "tx",
    })

    useEffect(() => {
        if (!pendingAction || tx?.finalHash || !reviewRef.current) return
        const review = reviewRef.current
        // Isolate the review from all surrounding app chrome, not just the
        // transaction view's siblings. An OS window/header may sit higher up.
        const priorInert: Array<readonly [HTMLElement, boolean]> = []
        let pathNode: HTMLElement = review
        while (pathNode.parentElement) {
            const parent = pathNode.parentElement
            for (const sibling of parent.children) {
                if (sibling instanceof HTMLElement && sibling !== pathNode) {
                    priorInert.push([sibling, sibling.inert])
                    sibling.inert = true
                }
            }
            pathNode = parent
        }
        review.focus()

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault()
                event.stopPropagation()
                restoreReviewFocus.current = true
                setPendingAction(null)
                return
            }
            if (event.key !== "Tab") return
            const controls = Array.from(review.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled])'))
            if (controls.length === 0) { event.preventDefault(); return }
            const first = controls[0]
            const last = controls[controls.length - 1]
            if (document.activeElement === review) {
                event.preventDefault()
                ;(event.shiftKey ? last : first).focus()
            } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first.focus()
            }
        }
        review.addEventListener("keydown", onKeyDown)
        return () => {
            review.removeEventListener("keydown", onKeyDown)
            priorInert.forEach(([node, inert]) => { node.inert = inert })
            if (restoreReviewFocus.current) {
                restoreReviewFocus.current = false
                requestAnimationFrame(() => { if (reviewOpener.current?.isConnected) reviewOpener.current.focus() })
            }
        }
    }, [pendingAction, tx?.finalHash])

    const handleSign = async () => {
        if (!token || !tx || actionLoading || reviewError || receipt) return
        setActionLoading(true)
        setActionError(null)
        try {
            if (!native) throw new Error(LEGACY_READ_ONLY_MESSAGE)
            assertNativeAction(tx.chainId)
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
            await refreshAccounts()
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
        setBroadcastAlert("")
        setActionNotice("")
        setBroadcastStep("sending")
        try {
            if (isNativeMultisig(tx.multisigPubkeyJson)) {
                assertNativeAction(tx.chainId)
                const fresh = await api.getTransaction({ authToken: token, transactionId: tx.id })
                if (!fresh.transaction || nativeReceiptKey(fresh.transaction, token.userAddress ?? adena.address ?? "", API_BASE_URL) !== receiptKey) throw new Error("Transaction identity changed; reload and review again")
                // A completion response may have been lost. Read the server's
                // state first; completed rows reject another Complete RPC.
                if (fresh.transaction.finalHash) {
                    const refreshed = await txQuery.refetch()
                    if (refreshed.data?.transaction?.finalHash) {
                        clearNativeReceipt(receiptKey)
                        await refreshAccounts()
                    }
                    return
                }
                let hash = readNativeReceipt(receiptKey)
                if (hash && !validReceiptHash(hash)) {
                    setBroadcastAlert("Recovery record is unavailable or invalid. Inspect it before any further broadcast.")
                    return
                }
                if (!hash) {
                    if (reviewError) throw new Error(reviewError)
                    if (!fresh.nativeTxBytes.length) throw new Error(fresh.nativeExportError || "Native aggregate is not ready")
                    // An earlier broadcast whose reply was lost may already be on chain, and no
                    // receipt was kept for it. The backend records a hash only after finding that
                    // transaction on chain and checking it against this proposal, so it is asked
                    // first and the bytes are sent only if it answers "not on chain". The backend
                    // assembles from the earliest signatures, so today's bytes are the bytes any
                    // member sent since quorum; the hashes this browser sent are asked about too,
                    // for a broadcast made before the backend kept them fixed.
                    const expected = nativeTxHash(fresh.nativeTxBytes)
                    setBroadcastStep("asking")
                    let answer: Awaited<ReturnType<typeof askWhetherOnChain>> = "absent"
                    for (const sent of new Set([...readBroadcastAttempts(receiptKey), expected])) {
                        answer = await askWhetherOnChain(token, tx.id, sent)
                        if (answer !== "absent") break
                    }
                    if (answer === "unanswered") throw new Error("Couldn't check whether this transaction is already on chain. Nothing was sent; try again in a moment.")
                    if (answer === "recorded") setActionNotice("This transaction was already executed on chain. Nothing was sent; Memba recorded the result.")
                    // "completed": another member recorded it meanwhile. Nothing to send; the refresh below shows it.
                    if (answer === "absent") {
                        assertReceiptStorage(receiptKey)
                        saveBroadcastAttempt(receiptKey, expected)
                        setBroadcastStep("sending")
                        hash = await broadcastNativeTransaction(tx.chainId, fresh.nativeTxBytes)
                        if (!saveNativeReceipt(receiptKey, hash)) setRecoveryWarning("Browser storage failed after broadcast. Copy the hash before leaving this tab; receipt retry is still available here.")
                    }
                }
                if (hash) await api.completeTransaction({ authToken: token, transactionId: tx.id, finalHash: hash })
                const refreshed = await txQuery.refetch()
                // Keep the hint if refresh fails or remains stale: never turn
                // a successful broadcast back into a broadcast-ready button.
                if (refreshed.data?.transaction?.finalHash) {
                    clearNativeReceipt(receiptKey)
                    await refreshAccounts()
                }
                return
            }
            // Legacy (non-native) records are read-only history: their addresses
            // cannot execute on Gno and the backend refuses to complete them.
            throw new Error(LEGACY_READ_ONLY_MESSAGE)
        } catch (err) {
            if (err instanceof NativeOutcomeUnknownError) setBroadcastAlert(err.message)
            else setActionError(err instanceof Error ? err.message : "Broadcast failed")
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
    const status = getMultisigStatus(tx, nativeReady)

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
                        <SignedText value={msg.label} className="k-txview__msg-label" />
                    </div>
                    {msg.fields.map((field, j) => (
                        <div key={j} className="k-txview__field-row">
                            <span className="k-label k-txview__field-key">{field.key}</span>
                            <span className={[
                                "k-txview__field-value",
                                field.accent ? "k-txview__field-value--accent" : "",
                                field.key === "Raw" ? "k-txview__field-value--raw" : "",
                            ].filter(Boolean).join(" ")}>
                                <SigningField field={field} />
                            </span>
                        </div>
                    ))}
                </div>
            ))}

            {/* ── Details card ─────────────────────────────────── */}
            <div className="k-card k-txview__detail-card">
                <DetailRow label="Multisig" value={<CopyableAddress address={tx.multisigAddress} fontSize={13} />} />
                <DetailRow label="Chain" value={tx.chainId} />
                <DetailRow label="Memo" value={tx.memo ? <SignedText value={tx.memo} /> : "—"} />
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
            {actionNotice && <p role="status">{actionNotice}</p>}
            {broadcastAlert && !tx.finalHash && <p role="alert" style={{ overflowWrap: "anywhere" }}>{broadcastAlert}</p>}
            {native && !ENABLE_NATIVE_GNO_MULTISIG && !tx.finalHash && <p role="status">Native signing and broadcasting are on hold pending release approval.</p>}
            {native && receipt && !tx.finalHash && <div className="k-card" role="status">
                <p>Broadcast receipt recovery — this saved hash is not proof of completion. The backend must verify it on-chain.</p>
                <code style={{ overflowWrap: "anywhere" }}>{validReceiptHash(receipt) ? receipt : "Recovery record is unavailable or invalid; inspect it before continuing."}</code>
                {recoveryWarning && <p role="alert">{recoveryWarning}</p>}
                <p>{ENABLE_NATIVE_GNO_MULTISIG ? "Retry only saves the verified receipt. It does not broadcast again." : "Receipt verification is on hold. Check this hash on-chain before any future retry."}</p>
                <button className="k-btn-primary" disabled={!ENABLE_NATIVE_GNO_MULTISIG || actionLoading || !auth.isAuthenticated || !validReceiptHash(receipt)} onClick={() => void handleBroadcast()}>
                    {actionLoading ? "Checking receipt..." : "Retry receipt verification"}
                </button>
            </div>}
            {native && txQuery.data?.nativeExportError && <p role="status">{txQuery.data.nativeExportError}</p>}
            {!native && !tx.finalHash && <p role="status">{LEGACY_READ_ONLY_MESSAGE}</p>}
            {native && !tx.finalHash && tx.onchainError && <p role="status">
                The network refused this transaction before executing it: <code style={{ overflowWrap: "anywhere" }}>{tx.onchainError}</code>.
                The signed transaction is still valid and can be broadcast again.
            </p>}
            {!tx.finalHash && auth.isAuthenticated && native && ENABLE_NATIVE_GNO_MULTISIG && (
                <div className="k-txview__actions">
                    <button
                        className="k-btn-primary"
                        disabled={actionLoading || !!reviewError || !!receipt || tx.signatures.some(s => s.userAddress === adena.address)}
                        onClick={event => { reviewOpener.current = event.currentTarget; restoreReviewFocus.current = false; setPendingAction("sign") }}
                        style={{ opacity: actionLoading ? 0.5 : 1 }}
                    >
                        {actionLoading ? "Signing..." : tx.signatures.some(s => s.userAddress === adena.address) ? "Already Signed" : "Sign Transaction"}
                    </button>
                    {native && nativeReady && !receipt && (
                        <button
                            className="k-btn-primary"
                            style={{ background: "var(--color-k-accent-hover)", opacity: actionLoading ? 0.5 : 1 }}
                            disabled={actionLoading || !!reviewError}
                            onClick={event => { reviewOpener.current = event.currentTarget; restoreReviewFocus.current = false; setPendingAction("broadcast") }}
                        >
                            {actionLoading ? (broadcastStep === "asking" ? "Checking the chain..." : "Broadcasting...") : "Broadcast to Chain"}
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
            {pendingAction && !tx.finalHash && ENABLE_NATIVE_GNO_MULTISIG && (
                <div ref={reviewRef} tabIndex={-1} className="k-card k-txview__confirm-card" role="alertdialog" aria-modal="true" aria-label="Review transaction" style={{
                    border: "1px solid var(--color-k-amber-border)",
                    display: "flex", flexDirection: "column", gap: 12, padding: 18,
                }}>
                    <h3 style={{ fontSize: "var(--pro-body, 14px)", fontWeight: 700, margin: 0 }}>
                        Review before you {pendingAction === "sign" ? "sign" : "broadcast"}
                    </h3>
                    {parsedMsgs.map((msg, i) => (
                        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <span style={{ fontSize: "var(--pro-small, 12px)", fontWeight: 600 }}><SignedText value={msg.label} /></span>
                            {msg.fields.map((field, j) => (
                                <div key={j} style={{ display: "flex", gap: 8, fontSize: "var(--pro-small, 12px)" }}>
                                    <span className="k-label" style={{ minWidth: 90 }}>{field.key}</span>
                                    <span style={{ fontFamily: "var(--font-ui, JetBrains Mono, monospace)", wordBreak: "break-all" }}><SigningField field={field} /></span>
                                </div>
                            ))}
                        </div>
                    ))}
                    {tx.memo && (
                        <div style={{ display: "flex", gap: 8, fontSize: "var(--pro-small, 12px)" }}>
                            <span className="k-label" style={{ minWidth: 90 }}>Memo</span>
                            <SignedText value={tx.memo} />
                        </div>
                    )}
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
                        <button className="k-btn-secondary" onClick={() => { restoreReviewFocus.current = true; setPendingAction(null) }}>Cancel</button>
                        <button
                            className="k-btn-primary"
                            disabled={actionLoading || !!reviewError || !!receipt}
                            onClick={() => {
                                const action = pendingAction
                                restoreReviewFocus.current = true
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
            {showManualSig && !tx.finalHash && auth.isAuthenticated && native && ENABLE_NATIVE_GNO_MULTISIG && (
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
                                assertNativeAction(tx.chainId)
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
                                await refreshAccounts()
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
                        {native && tx.onchainError ? (
                            <span style={{
                                fontSize: "var(--pro-caption, 10px)", padding: "2px 8px", borderRadius: 4,
                                background: "rgba(239,68,68,0.1)", color: "var(--color-danger, #ef4444)",
                                fontFamily: "var(--font-ui, JetBrains Mono, monospace)",
                            }}>✗ FAILED ON-CHAIN</span>
                        ) : tx.verified && !native ? (
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
                    {native && tx.onchainError && <p role="status">
                        The network refused this transaction: <code style={{ overflowWrap: "anywhere" }}>{tx.onchainError}</code>.
                        The multisig's sequence number has moved past this proposal's, so it can never run and this proposal is closed. To try again, create a new proposal.
                    </p>}
                </div>
            )}

            <ErrorToast message={error} onDismiss={dismissError} />
        </div>
    )
}

/** One parsed field as a co-signer must read it: full addresses, separate arguments, invisible characters revealed. */
function SigningField({ field }: { field: ParsedField }) {
    if (field.args) return <SignedArgs args={field.args} />
    if (field.identifier && field.value !== "—") return <SignedAddress value={field.value} />
    return <SignedText value={field.value} />
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="k-txview__detail-row">
            <span className="k-label">{label}</span>
            <span className="k-txview__detail-value">{value}</span>
        </div>
    )
}
