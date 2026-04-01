import { useEffect, useState, useCallback } from "react"
import { useParams, useOutletContext } from "react-router-dom"
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
import { GNO_RPC_URL } from "../lib/config"
import { completeQuest } from "../lib/quests"
import type { LayoutContext } from "../types/layout"
import "./txview.css"

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

    const [tx, setTx] = useState<Transaction | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [actionLoading, setActionLoading] = useState(false)
    const [manualSig, setManualSig] = useState("")
    const [showManualSig, setShowManualSig] = useState(false)
    const [linkCopied, setLinkCopied] = useState(false)

    const fetchTx = useCallback(async () => {
        if (!token || !id) return
        setLoading(true)
        setError(null)
        try {
            const res = await api.getTransaction({
                authToken: token,
                transactionId: Number(id),
            })
            if (res.transaction) {
                setTx(res.transaction)
            } else {
                setError("Transaction not found")
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load transaction")
        } finally {
            setLoading(false)
        }
    }, [token, id])

    useEffect(() => { fetchTx() }, [fetchTx])

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
                <ErrorToast message={error} onDismiss={() => setError(null)} />
            </div>
        )
    }

    // ── Parse data ────────────────────────────────────────────
    const status = getTxStatus(tx.finalHash, tx.signatures.length, tx.threshold)
    const parsedMsgs = parseMsgs(tx.msgsJson)
    const fee = parseFee(tx.feeJson)

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
                                <span className="k-txview__signed-badge">Signed</span>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* ── Actions ─────────────────────────────────────── */}
            {!tx.finalHash && auth.isAuthenticated && (
                <div className="k-txview__actions">
                    <button
                        className="k-btn-primary"
                        disabled={actionLoading}
                        onClick={async () => {
                            if (!token || !tx || actionLoading) return
                            setActionLoading(true)
                            setError(null)
                            try {
                                const signDoc = JSON.stringify(buildSignDoc(tx))
                                const signDocBytes = new TextEncoder().encode(signDoc)

                                const signature = await adena.signArbitrary(signDoc)
                                if (!signature) {
                                    setError("Signature rejected")
                                    setActionLoading(false)
                                    return
                                }

                                await api.signTransaction({
                                    authToken: token,
                                    transactionId: tx.id,
                                    signature,
                                    bodyBytes: signDocBytes,
                                })

                                await fetchTx()
                            } catch (err) {
                                setError(err instanceof Error ? err.message : "Failed to sign")
                            } finally {
                                setActionLoading(false)
                            }
                        }}
                        style={{ opacity: actionLoading ? 0.5 : 1 }}
                    >
                        {actionLoading ? "Signing..." : "Sign Transaction"}
                    </button>
                    {tx.signatures.length >= tx.threshold && (
                        <button
                            className="k-btn-primary"
                            style={{ background: "#00e6bb", opacity: actionLoading ? 0.5 : 1 }}
                            disabled={actionLoading}
                            onClick={async () => {
                                if (!token || !tx || actionLoading) return
                                setActionLoading(true)
                                setError(null)
                                try {
                                    const broadcastTx = buildBroadcastTx(tx)
                                    const res = await fetch(`${GNO_RPC_URL}/broadcast_tx_commit?tx=0x${broadcastTx}`, {
                                        method: "GET",
                                    })
                                    const json = await res.json()

                                    const hash = json?.result?.hash
                                    if (!hash) {
                                        const errMsg = json?.result?.deliver_tx?.log || json?.error?.message || "Broadcast failed"
                                        setError(errMsg)
                                        return
                                    }

                                    await api.completeTransaction({
                                        authToken: token,
                                        transactionId: tx.id,
                                        finalHash: hash,
                                    })

                                    await fetchTx()
                                } catch (err) {
                                    setError(err instanceof Error ? err.message : "Broadcast failed")
                                } finally {
                                    setActionLoading(false)
                                }
                            }}
                        >
                            {actionLoading ? "Broadcasting..." : "Broadcast to Chain"}
                        </button>
                    )}
                    <button
                        className="k-btn-secondary"
                        onClick={() => {
                            const json = JSON.stringify(buildSignDoc(tx), null, 2)
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
                    <button
                        className="k-btn-secondary"
                        onClick={() => setShowManualSig(!showManualSig)}
                    >
                        {showManualSig ? "Hide" : "Paste gnokey Sig"}
                    </button>
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
                        disabled={!manualSig.trim() || actionLoading}
                        style={{ opacity: manualSig.trim() && !actionLoading ? 1 : 0.5, alignSelf: "flex-start" }}
                        onClick={async () => {
                            if (!token || !tx || !manualSig.trim()) return
                            setActionLoading(true)
                            setError(null)
                            try {
                                const signDoc = JSON.stringify(buildSignDoc(tx))
                                await api.signTransaction({
                                    authToken: token,
                                    transactionId: tx.id,
                                    signature: manualSig.trim(),
                                    bodyBytes: new TextEncoder().encode(signDoc),
                                })
                                setManualSig("")
                                setShowManualSig(false)
                                await fetchTx()
                            } catch (err) {
                                setError(err instanceof Error ? err.message : "Failed to submit signature")
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
                    <p className="k-label k-txview__hash-label">Transaction Hash</p>
                    <p className="k-txview__hash-value">
                        {tx.finalHash}
                    </p>
                </div>
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} />
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

/**
 * Build a hex-encoded Amino broadcast TX from multi-sig data.
 */
function buildBroadcastTx(tx: Transaction): string {
    let multisigPubkey: {
        type: string;
        value: { threshold: string; pubkeys: { type: string; value: string }[] };
    } | null = null

    try {
        multisigPubkey = JSON.parse(tx.multisigPubkeyJson)
    } catch {
        // If parsing fails, fall back to the raw value
    }

    const orderedSigs = tx.signatures.map(sig => ({
        pub_key: null,
        signature: sig.value,
    }))

    const broadcastDoc = {
        type: "auth/StdTx",
        value: {
            msg: JSON.parse(tx.msgsJson),
            fee: JSON.parse(tx.feeJson),
            signatures: [{
                pub_key: multisigPubkey,
                signature: orderedSigs.map(s => s.signature).join(","),
            }],
            memo: tx.memo || "",
        },
    }
    const jsonStr = JSON.stringify(broadcastDoc)
    return Array.from(new TextEncoder().encode(jsonStr))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("")
}
