import { useEffect, useState, useCallback } from "react"
import { useParams, useOutletContext } from "react-router-dom"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { api } from "../lib/api"
import { useBalance } from "../hooks/useBalance"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { StatusBadge } from "../components/ui/StatusBadge"
import { getTxStatus } from "../components/ui/txStatus"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { ErrorToast } from "../components/ui/ErrorToast"
import type { Multisig, Transaction } from "../gen/memba/v1/memba_pb"
import { ExecutionState } from "../gen/memba/v1/memba_pb"
import { GNO_CHAIN_ID, GNO_BECH32_PREFIX } from "../lib/config"
import type { LayoutContext } from "../types/layout"
import "./multisigview.css"

export function MultisigView() {
    const { address } = useParams<{ address: string }>()
    const navigate = useNetworkNav()
    const { auth } = useOutletContext<LayoutContext>()
    const token = auth.token

    const [multisig, setMultisig] = useState<Multisig | null>(null)
    const [pendingTxs, setPendingTxs] = useState<Transaction[]>([])
    const [executedTxs, setExecutedTxs] = useState<Transaction[]>([])
    const [txTab, setTxTab] = useState<"pending" | "executed">("pending")
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const [editing, setEditing] = useState(false)
    const [editName, setEditName] = useState("")

    const { balance } = useBalance(address || null)

    const fetchData = useCallback(async () => {
        if (!token || !address || !auth.isAuthenticated) return
        setLoading(true)
        setError(null)
        try {
            const [infoRes, pendingRes, executedRes] = await Promise.all([
                api.multisigInfo({ authToken: token, multisigAddress: address, chainId: GNO_CHAIN_ID }),
                api.transactions({ authToken: token, multisigAddress: address, chainId: GNO_CHAIN_ID, executionState: ExecutionState.PENDING, limit: 50 }),
                api.transactions({ authToken: token, multisigAddress: address, chainId: GNO_CHAIN_ID, executionState: ExecutionState.EXECUTED, limit: 50 }),
            ])
            setMultisig(infoRes.multisig ?? null)
            setPendingTxs(pendingRes.transactions)
            setExecutedTxs(executedRes.transactions)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load multisig")
        } finally {
            setLoading(false)
        }
    }, [token, address, auth.isAuthenticated])

    useEffect(() => { fetchData() }, [fetchData])

    const formatDate = (dateStr: string) => {
        try {
            return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        } catch { return dateStr }
    }

    const handleRename = async () => {
        const name = editName.trim()
        if (!name || !token || !multisig?.pubkeyJson) { setEditing(false); return }
        try {
            await api.createOrJoinMultisig({
                authToken: token,
                chainId: multisig.chainId || GNO_CHAIN_ID,
                multisigPubkeyJson: multisig.pubkeyJson,
                name,
                bech32Prefix: GNO_BECH32_PREFIX,
            })
            setEditing(false)
            fetchData()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Rename failed")
            setEditing(false)
        }
    }

    // ── Not authenticated ───────────────────────────────
    if (!auth.isAuthenticated) {
        return (
            <div className="animate-fade-in k-msview">
                <button className="k-msview__back" onClick={() => navigate("/")}>← Back to Dashboard</button>
                <div className="k-dashed k-msview__auth-gate">
                    <p className="k-msview__auth-text">Connect your wallet to view multisig details</p>
                </div>
            </div>
        )
    }

    // ── Loading ─────────────────────────────────────────
    if (loading) {
        return (
            <div className="animate-fade-in k-msview">
                <button className="k-msview__back" onClick={() => navigate("/")}>← Back to Dashboard</button>
                <SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
        )
    }

    return (
        <div className="animate-fade-in k-msview">
            {/* Header */}
            <div>
                <button className="k-msview__back" onClick={() => navigate("/")}>← Back to Dashboard</button>
                <div className="k-msview__header-row">
                    <div>
                        {editing ? (
                            <div className="k-msview__rename">
                                <input
                                    className="k-msview__rename-input"
                                    autoFocus
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setEditing(false) }}
                                    placeholder="Multisig name..."
                                />
                                <button className="k-msview__rename-save" onClick={handleRename}>Save</button>
                                <button className="k-msview__rename-cancel" onClick={() => setEditing(false)}>Cancel</button>
                            </div>
                        ) : (
                            <h2
                                className="k-msview__title"
                                onClick={() => { setEditName(multisig?.name || ""); setEditing(true) }}
                                title="Click to rename"
                            >
                                {multisig?.name || "Multisig Wallet"}
                                <span className="k-msview__title-edit">✏️</span>
                            </h2>
                        )}
                        <div style={{ marginTop: 4 }}>
                            <CopyableAddress address={address || ""} fontSize={12} />
                        </div>
                        <button
                            className={`k-msview__share-btn ${copied ? "k-msview__share-btn--copied" : ""}`}
                            onClick={() => {
                                const origin = window.location.origin
                                let shareUrl = `${origin}/multisig/${address}`
                                if (multisig?.pubkeyJson) {
                                    const encoded = btoa(multisig.pubkeyJson)
                                    const name = encodeURIComponent(multisig.name || "")
                                    shareUrl = `${origin}/import?pubkey=${encodeURIComponent(encoded)}&name=${name}`
                                }
                                navigator.clipboard.writeText(shareUrl)
                                setCopied(true)
                                setTimeout(() => setCopied(false), 2000)
                            }}
                        >
                            {copied ? "✓ Link Copied!" : "📎 Share Import Link"}
                        </button>
                    </div>
                    <div className="k-msview__actions">
                        <button className="k-btn-primary" onClick={() => navigate(`/multisig/${address}/propose`)}>
                            Propose Transaction
                        </button>
                        {multisig && (
                            <button
                                className="k-btn-secondary"
                                onClick={() => {
                                    const config = {
                                        version: "memba-config-v1",
                                        chainId: multisig.chainId || GNO_CHAIN_ID,
                                        address: multisig.address,
                                        name: multisig.name || "",
                                        threshold: multisig.threshold,
                                        membersCount: multisig.membersCount,
                                        pubkeyJson: multisig.pubkeyJson,
                                        members: multisig.usersAddresses,
                                        exportedAt: new Date().toISOString(),
                                    }
                                    const json = JSON.stringify(config, null, 2)
                                    const blob = new Blob([json], { type: "application/json" })
                                    const url = URL.createObjectURL(blob)
                                    const a = document.createElement("a")
                                    a.href = url
                                    a.download = `memba-multisig-${(address || "unknown").slice(0, 10)}.json`
                                    a.click()
                                    URL.revokeObjectURL(url)
                                }}
                            >
                                Export Config
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Action Required Banner ───────────────────── */}
            {(() => {
                const userAddr = (auth as { address?: string }).address || ""
                const unsignedCount = pendingTxs.filter(tx =>
                    !tx.signatures.some(s => s.userAddress === userAddr)
                ).length
                if (unsignedCount === 0) return null
                return (
                    <div className="k-msview__action-banner">
                        <span style={{ fontSize: 14 }}>⚡</span>
                        <span className="k-msview__action-text">
                            ✍️ {unsignedCount} transaction{unsignedCount > 1 ? "s" : ""} need{unsignedCount === 1 ? "s" : ""} your signature
                        </span>
                        <button className="k-msview__action-btn" onClick={() => setTxTab("pending")}>
                            View pending →
                        </button>
                    </div>
                )
            })()}

            {/* Info cards */}
            <div className="k-msview__info-grid">
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
                <h3 className="k-msview__section-title">Members</h3>
                <div className="k-card k-msview__table-card">
                    <div className="k-msview__table-header k-msview__table-header--2col">
                        <span>Address</span>
                        <span>Status</span>
                    </div>
                    {multisig?.usersAddresses && multisig.usersAddresses.length > 0 ? (
                        multisig.usersAddresses.map((addr, i) => (
                            <div key={i} className="k-msview__table-row">
                                <CopyableAddress address={addr} fontSize={12} />
                                <span className="k-msview__member-badge">Member</span>
                            </div>
                        ))
                    ) : (
                        <div className="k-msview__empty">
                            <p className="k-msview__empty-text">No members found</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Transactions — Tabbed */}
            <div>
                <div className="k-msview__tabs">
                    <button
                        className={`k-msview__tab ${txTab === "pending" ? "k-msview__tab--active" : ""}`}
                        onClick={() => setTxTab("pending")}
                    >
                        Pending ({pendingTxs.length})
                    </button>
                    <button
                        className={`k-msview__tab ${txTab === "executed" ? "k-msview__tab--active" : ""}`}
                        onClick={() => setTxTab("executed")}
                    >
                        Completed ({executedTxs.length})
                    </button>
                </div>
                {renderTxList(txTab === "pending" ? pendingTxs : executedTxs, txTab === "pending" ? "No pending transactions" : "No completed transactions")}
            </div>

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )

    function renderTxList(txs: Transaction[], emptyMsg: string) {
        if (txs.length === 0) {
            return (
                <div className="k-card k-msview__empty">
                    <p className="k-msview__empty-text">{emptyMsg}</p>
                </div>
            )
        }
        return (
            <div className="k-card k-msview__table-card">
                <div className="k-msview__table-header k-msview__table-header--3col">
                    <span>Type</span>
                    <span>Status</span>
                    <span>Date</span>
                </div>
                {txs.map((tx) => {
                    const status = getTxStatus(tx.finalHash, tx.signatures.length, tx.threshold)
                    return (
                        <div
                            key={tx.id}
                            className="k-activity-row k-msview__tx-row"
                            onClick={() => navigate(`/tx/${tx.id}?ms=${address}&chain=${GNO_CHAIN_ID}`)}
                        >
                            <span className="k-msview__tx-type">{tx.type || "send"}</span>
                            <span><StatusBadge status={status} sigCount={tx.signatures.length} threshold={tx.threshold} /></span>
                            <span className="k-msview__tx-date">{formatDate(tx.createdAt)}</span>
                        </div>
                    )
                })}
            </div>
        )
    }
}
