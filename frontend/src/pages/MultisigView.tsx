import { useEffect, useState, useCallback } from "react"
import { useNavigate, useParams, useOutletContext } from "react-router-dom"
import { api } from "../lib/api"
import { useBalance } from "../hooks/useBalance"
import { StatusBadge } from "../components/ui/StatusBadge"
import { getTxStatus } from "../components/ui/txStatus"
import { SkeletonCard, SkeletonRow } from "../components/ui/LoadingSkeleton"
import { ErrorToast } from "../components/ui/ErrorToast"
import type { Multisig, Transaction } from "../gen/memba/v1/memba_pb"
import { ExecutionState } from "../gen/memba/v1/memba_pb"
import type { LayoutContext } from "../types/layout"

const GNO_CHAIN_ID = import.meta.env.VITE_GNO_CHAIN_ID || "test11"

export function MultisigView() {
    const { address } = useParams<{ address: string }>()
    const navigate = useNavigate()
    const { auth } = useOutletContext<LayoutContext>()
    const token = auth.token

    const [multisig, setMultisig] = useState<Multisig | null>(null)
    const [pendingTxs, setPendingTxs] = useState<Transaction[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const { balance } = useBalance(address || null)

    const fetchData = useCallback(async () => {
        if (!token || !address || !auth.isAuthenticated) return
        setLoading(true)
        setError(null)
        try {
            const [infoRes, txRes] = await Promise.all([
                api.multisigInfo({ authToken: token, multisigAddress: address, chainId: GNO_CHAIN_ID }),
                api.transactions({ authToken: token, multisigAddress: address, chainId: GNO_CHAIN_ID, executionState: ExecutionState.PENDING, limit: 20 }),
            ])
            setMultisig(infoRes.multisig ?? null)
            setPendingTxs(txRes.transactions)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load multisig")
        } finally {
            setLoading(false)
        }
    }, [token, address, auth.isAuthenticated])

    useEffect(() => { fetchData() }, [fetchData])

    const truncateAddr = (addr: string) =>
        addr.length > 20 ? `${addr.slice(0, 10)}…${addr.slice(-8)}` : addr

    const formatDate = (dateStr: string) => {
        try {
            return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        } catch { return dateStr }
    }

    // ── Not authenticated ───────────────────────────────
    if (!auth.isAuthenticated) {
        return (
            <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                <button onClick={() => navigate("/")} style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", marginBottom: 16, fontFamily: "JetBrains Mono, monospace" }}>
                    ← Back to Dashboard
                </button>
                <div className="k-dashed" style={{ background: "#0c0c0c", padding: 48, textAlign: "center" }}>
                    <p style={{ color: "#666", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                        Connect your wallet to view multisig details
                    </p>
                </div>
            </div>
        )
    }

    // ── Loading ─────────────────────────────────────────
    if (loading) {
        return (
            <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                <button onClick={() => navigate("/")} style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace" }}>
                    ← Back to Dashboard
                </button>
                <SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
        )
    }

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            {/* Header */}
            <div>
                <button onClick={() => navigate("/")} style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", marginBottom: 16, fontFamily: "JetBrains Mono, monospace" }}>
                    ← Back to Dashboard
                </button>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
                    <div>
                        <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
                            {multisig?.name || "Multisig Wallet"}
                        </h2>
                        <p style={{ color: "#666", fontSize: 12, marginTop: 4, fontFamily: "JetBrains Mono, monospace", wordBreak: "break-all" }}>
                            {address}
                        </p>
                    </div>
                    <button
                        className="k-btn-primary"
                        onClick={() => navigate(`/multisig/${address}/propose`)}
                    >
                        Propose Transaction
                    </button>
                </div>
            </div>

            {/* Info cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                <div className="k-card">
                    <p className="k-label">Threshold</p>
                    <p className="k-value k-value-accent">
                        {multisig ? `${multisig.threshold} of ${multisig.membersCount}` : "—"}
                    </p>
                </div>
                <div className="k-card">
                    <p className="k-label">Balance</p>
                    <p className="k-value">{balance}</p>
                </div>
                <div className="k-card">
                    <p className="k-label">Pending TX</p>
                    <p className="k-value">{pendingTxs.length}</p>
                </div>
            </div>

            {/* Members */}
            <div>
                <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Members</h3>
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
                    {multisig?.usersAddresses && multisig.usersAddresses.length > 0 ? (
                        multisig.usersAddresses.map((addr, i) => (
                            <div key={i} style={{
                                padding: "12px 20px", borderBottom: "1px solid #111",
                                display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center",
                            }}>
                                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "#ccc" }}>
                                    {truncateAddr(addr)}
                                </span>
                                <span style={{
                                    fontSize: 11, padding: "2px 8px", borderRadius: 4,
                                    background: "rgba(0,212,170,0.08)", color: "#00d4aa",
                                    fontFamily: "JetBrains Mono, monospace",
                                }}>
                                    Member
                                </span>
                            </div>
                        ))
                    ) : (
                        <div style={{ padding: 32, textAlign: "center" }}>
                            <p style={{ color: "#555", fontSize: 14, fontFamily: "JetBrains Mono, monospace" }}>
                                No members found
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Pending Transactions */}
            <div>
                <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Pending Transactions</h3>
                {pendingTxs.length === 0 ? (
                    <div className="k-card" style={{ textAlign: "center", padding: 32 }}>
                        <p style={{ color: "#555", fontSize: 14, fontFamily: "JetBrains Mono, monospace" }}>
                            No pending transactions
                        </p>
                    </div>
                ) : (
                    <div className="k-card" style={{ padding: 0, overflow: "hidden" }}>
                        <div style={{
                            padding: "12px 20px", borderBottom: "1px solid #222",
                            display: "grid", gridTemplateColumns: "1fr 1fr auto",
                            fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#555",
                            textTransform: "uppercase", letterSpacing: "0.05em",
                        }}>
                            <span>Type</span>
                            <span>Status</span>
                            <span>Date</span>
                        </div>
                        {pendingTxs.map((tx) => {
                            const status = getTxStatus(tx.finalHash, tx.signatures.length, tx.threshold)
                            return (
                                <div
                                    key={tx.id}
                                    onClick={() => navigate(`/tx/${tx.id}?ms=${address}&chain=${GNO_CHAIN_ID}`)}
                                    className="k-activity-row"
                                    style={{
                                        display: "grid", gridTemplateColumns: "1fr 1fr auto",
                                        padding: "14px 20px", borderBottom: "1px solid #1a1a1a",
                                        cursor: "pointer", transition: "background 0.15s",
                                        fontSize: 13, fontFamily: "JetBrains Mono, monospace",
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = "#0c0c0c"}
                                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                                >
                                    <span style={{ color: "#f0f0f0", textTransform: "capitalize" }}>{tx.type || "send"}</span>
                                    <span><StatusBadge status={status} sigCount={tx.signatures.length} threshold={tx.threshold} /></span>
                                    <span style={{ color: "#555", fontSize: 11 }}>{formatDate(tx.createdAt)}</span>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}
