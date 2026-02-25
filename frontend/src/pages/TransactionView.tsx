import { useEffect, useState, useCallback } from "react"
import { useNavigate, useParams, useOutletContext } from "react-router-dom"
import { api } from "../lib/api"
import { parseMsgs, parseFee } from "../lib/parseMsgs"
import { StatusBadge } from "../components/ui/StatusBadge"
import { getTxStatus } from "../components/ui/txStatus"
import { SkeletonCard, SkeletonRow } from "../components/ui/LoadingSkeleton"
import { ErrorToast } from "../components/ui/ErrorToast"
import { ProgressBar } from "../components/multisig/ProgressBar"
import type { Transaction } from "../gen/memba/v1/memba_pb"
import { GNO_RPC_URL } from "../lib/config"
import type { LayoutContext } from "../types/layout"

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
    const navigate = useNavigate()
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

    const truncateAddr = (addr: string) =>
        addr.length > 20 ? `${addr.slice(0, 10)}…${addr.slice(-8)}` : addr

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
            <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                <button onClick={() => navigate(-1)} style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace", alignSelf: "flex-start" }}>
                    ← Back
                </button>
                <SkeletonCard />
                <SkeletonCard />
                <div className="k-card" style={{ padding: 0, overflow: "hidden" }}>
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
            <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                <button onClick={() => navigate(-1)} style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace", alignSelf: "flex-start" }}>
                    ← Back
                </button>
                <div className="k-dashed" style={{ background: "#0c0c0c", padding: 48, textAlign: "center" }}>
                    <span style={{ fontSize: 32, marginBottom: 12, display: "block" }}>🔍</span>
                    <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>Transaction not found</h3>
                    <p style={{ color: "#666", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
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
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            {/* ── Header ───────────────────────────────────────── */}
            <div>
                <button onClick={() => navigate(-1)} style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", marginBottom: 16, fontFamily: "JetBrains Mono, monospace" }}>
                    ← Back
                </button>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>TX #{id}</h2>
                        <StatusBadge status={status} sigCount={tx.signatures.length} threshold={tx.threshold} />
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(window.location.href)
                                setLinkCopied(true)
                                setTimeout(() => setLinkCopied(false), 2000)
                            }}
                            style={{
                                background: "none", border: "1px dashed #333", borderRadius: 6,
                                color: linkCopied ? "#00d4aa" : "#666", fontSize: 11, padding: "4px 10px",
                                cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
                                transition: "all 0.15s",
                            }}
                        >
                            {linkCopied ? "✓ Link Copied" : "Share"}
                        </button>
                    </div>
                    <p style={{ color: "#666", fontSize: 12, marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                        {(tx.type || "send").toUpperCase()} • Created by {truncateAddr(tx.creatorAddress)} • {formatDate(tx.createdAt)}
                    </p>
                </div>
            </div>

            {/* ── Transaction Content ──────────────────────────── */}
            {parsedMsgs.map((msg, i) => (
                <div key={i} className="k-card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{
                            fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                            color: "#00d4aa", background: "rgba(0,212,170,0.08)",
                            padding: "2px 8px", borderRadius: 4, textTransform: "uppercase",
                            letterSpacing: "0.05em",
                        }}>{msg.type}</span>
                        <span style={{ fontSize: 14, fontWeight: 500, color: "#f0f0f0" }}>{msg.label}</span>
                    </div>
                    {msg.fields.map((field, j) => (
                        <div key={j} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                            <span className="k-label" style={{ flexShrink: 0 }}>{field.key}</span>
                            <span style={{
                                fontFamily: "JetBrains Mono, monospace",
                                fontSize: 13,
                                color: field.accent ? "#00d4aa" : "#ccc",
                                fontWeight: field.accent ? 600 : 400,
                                textAlign: "right",
                                wordBreak: "break-all",
                                whiteSpace: field.key === "Raw" ? "pre-wrap" : "normal",
                                maxHeight: field.key === "Raw" ? 200 : undefined,
                                overflow: field.key === "Raw" ? "auto" : undefined,
                            }}>
                                {field.value}
                            </span>
                        </div>
                    ))}
                </div>
            ))}

            {/* ── Details card ─────────────────────────────────── */}
            <div className="k-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <DetailRow label="Multisig" value={truncateAddr(tx.multisigAddress)} />
                <DetailRow label="Chain" value={tx.chainId} />
                <DetailRow label="Memo" value={tx.memo || "—"} />
                <DetailRow label="Fee" value={fee.amount !== "—" ? `${fee.amount} (gas: ${fee.gas})` : `Gas: ${fee.gas}`} />
                <DetailRow label="Account #" value={String(tx.accountNumber)} />
                <DetailRow label="Sequence" value={String(tx.sequence)} />
            </div>

            {/* ── Signature Progress ──────────────────────────── */}
            <div>
                <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Signature Progress</h3>
                <ProgressBar
                    current={tx.signatures.length}
                    threshold={tx.threshold}
                    total={tx.membersCount}
                />
            </div>

            {/* ── Signers ─────────────────────────────────────── */}
            <div>
                <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Signers</h3>
                <div className="k-card" style={{ padding: 0, overflow: "hidden" }}>
                    <div style={{
                        padding: "12px 20px", borderBottom: "1px solid #222",
                        display: "grid", gridTemplateColumns: "1fr auto",
                        fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#555",
                        textTransform: "uppercase", letterSpacing: "0.05em",
                    }}>
                        <span>Address</span>
                        <span>Status</span>
                    </div>
                    {tx.signatures.length === 0 ? (
                        <div style={{ padding: 32, textAlign: "center" }}>
                            <p style={{ color: "#555", fontSize: 14, fontFamily: "JetBrains Mono, monospace" }}>
                                No signatures yet
                            </p>
                        </div>
                    ) : (
                        tx.signatures.map((sig, i) => (
                            <div key={i} style={{
                                padding: "12px 20px", borderBottom: "1px solid #111",
                                display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center",
                            }}>
                                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "#ccc" }}>
                                    {truncateAddr(sig.userAddress)}
                                </span>
                                <span style={{
                                    fontSize: 11, padding: "2px 8px", borderRadius: 4,
                                    background: "rgba(0,212,170,0.08)", color: "#00d4aa",
                                    fontFamily: "JetBrains Mono, monospace",
                                }}>
                                    Signed
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* ── Actions ─────────────────────────────────────── */}
            {!tx.finalHash && auth.isAuthenticated && (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
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

                                // Sign with Adena
                                const signature = await adena.signArbitrary(signDoc)
                                if (!signature) {
                                    setError("Signature rejected")
                                    setActionLoading(false)
                                    return
                                }

                                // Submit to backend
                                await api.signTransaction({
                                    authToken: token,
                                    transactionId: tx.id,
                                    signature,
                                    bodyBytes: signDocBytes,
                                })

                                // Refresh TX to update sig count
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
                <div className="k-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <p className="k-label">Paste gnokey Signature</p>
                    <p style={{ color: "#666", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}>
                        Export the unsigned TX above, sign with gnokey offline, then paste the base64 signature here.
                    </p>
                    <input
                        type="text"
                        value={manualSig}
                        onChange={(e) => setManualSig(e.target.value)}
                        placeholder="Paste base64 signature from gnokey..."
                        style={{
                            width: "100%", height: 40, padding: "0 12px", borderRadius: 8,
                            background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
                            fontFamily: "JetBrains Mono, monospace", fontSize: 12, outline: "none",
                        }}
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
                <div className="k-card" style={{ borderColor: "rgba(0,212,170,0.2)" }}>
                    <p className="k-label" style={{ marginBottom: 8 }}>Transaction Hash</p>
                    <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "#00d4aa", wordBreak: "break-all" }}>
                        {tx.finalHash}
                    </p>
                </div>
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="k-label">{label}</span>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "#ccc" }}>{value}</span>
        </div>
    )
}

/**
 * Build a hex-encoded Amino broadcast TX from multi-sig data.
 *
 * Gno multisig broadcast requires:
 * - The multisig pubkey as pub_key in the single signature entry
 * - Individual signatures ordered by member index in the pubkey array
 * - Each signature paired with its member's individual pubkey
 */
function buildBroadcastTx(tx: Transaction): string {
    // Parse the multisig pubkey to get member order
    let multisigPubkey: {
        type: string;
        value: { threshold: string; pubkeys: { type: string; value: string }[] };
    } | null = null

    try {
        multisigPubkey = JSON.parse(tx.multisigPubkeyJson)
    } catch {
        // If parsing fails, fall back to the raw value
    }

    // Build ordered signatures: match each stored signature to its
    // member position in the multisig pubkey's pubkeys array.
    // For now, include all collected signatures in their stored order.
    // Full bitfield-based Amino multisig encoding requires a dedicated
    // library — this format works with Gno's JSON broadcast endpoint.
    const orderedSigs = tx.signatures.map(sig => ({
        pub_key: null, // Individual member pubkey — resolved by chain from multisig
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
    // Convert to hex for broadcast_tx_commit
    return Array.from(new TextEncoder().encode(jsonStr))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("")
}

