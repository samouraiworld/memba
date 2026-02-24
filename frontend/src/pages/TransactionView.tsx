import { useEffect, useState, useCallback } from "react"
import { useNavigate, useParams, useOutletContext, useSearchParams } from "react-router-dom"
import { api } from "../lib/api"
import { parseMsgs, parseFee } from "../lib/parseMsgs"
import { StatusBadge } from "../components/ui/StatusBadge"
import { getTxStatus } from "../components/ui/txStatus"
import { SkeletonCard, SkeletonRow } from "../components/ui/LoadingSkeleton"
import { ErrorToast } from "../components/ui/ErrorToast"
import { ProgressBar } from "../components/multisig/ProgressBar"
import type { Transaction } from "../gen/memba/v1/memba_pb"
import type { LayoutContext } from "../types/layout"

const GNO_RPC_URL = import.meta.env.VITE_GNO_RPC_URL || "https://rpc.test11.testnets.gno.land:443"

export function TransactionView() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const { adena, auth } = useOutletContext<LayoutContext>()
    const token = auth.token

    // P0-A: Scope the fetch using query params (e.g. /tx/5?ms=g1abc&chain=test11)
    const multisigAddr = searchParams.get("ms") || ""
    const chainId = searchParams.get("chain") || ""

    const [tx, setTx] = useState<Transaction | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [actionLoading, setActionLoading] = useState(false)

    const fetchTx = useCallback(async () => {
        if (!token || !id) return
        setLoading(true)
        setError(null)
        try {
            // No dedicated GetTransaction RPC — fetch list and find by ID.
            // P0-A: Scope to multisig/chain if provided (avoids fetching all TXs).
            const res = await api.transactions({
                authToken: token,
                limit: 100,
                ...(multisigAddr && { multisigAddress: multisigAddr }),
                ...(chainId && { chainId }),
            })
            const found = res.transactions.find((t) => t.id === Number(id))
            if (found) {
                setTx(found)
            } else {
                setError("Transaction not found")
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load transaction")
        } finally {
            setLoading(false)
        }
    }, [token, id, multisigAddr, chainId])

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
                    <div>
                        <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Transaction #{tx.id}</h2>
                        <p style={{ color: "#666", fontSize: 12, marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                            {(tx.type || "send").toUpperCase()} • Created by {truncateAddr(tx.creatorAddress)} • {formatDate(tx.createdAt)}
                        </p>
                    </div>
                    <StatusBadge status={status} sigCount={tx.signatures.length} threshold={tx.threshold} hash={tx.finalHash} />
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
                                // Build Amino sign doc for this TX
                                const signDoc = JSON.stringify({
                                    account_number: String(tx.accountNumber),
                                    chain_id: tx.chainId,
                                    fee: JSON.parse(tx.feeJson),
                                    memo: tx.memo || "",
                                    msgs: JSON.parse(tx.msgsJson),
                                    sequence: String(tx.sequence),
                                })
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
                                    // Broadcast to chain via RPC
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

                                    // Record on backend
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

/** Build a hex-encoded Amino broadcast TX from multi-sig data. */
function buildBroadcastTx(tx: Transaction): string {
    // Build the signed TX JSON for broadcast
    const broadcastDoc = {
        type: "auth/StdTx",
        value: {
            msg: JSON.parse(tx.msgsJson),
            fee: JSON.parse(tx.feeJson),
            signatures: tx.signatures.map(sig => ({
                pub_key: null, // multisig handler resolves from pubkey
                signature: sig.value,
            })),
            memo: tx.memo || "",
        },
    }
    const jsonStr = JSON.stringify(broadcastDoc)
    // Convert to hex for broadcast_tx_commit
    return Array.from(new TextEncoder().encode(jsonStr))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("")
}

