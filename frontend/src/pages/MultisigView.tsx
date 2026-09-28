import { useState } from "react"
import { useParams, useOutletContext } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNetworkNav } from "../hooks/useNetworkNav"
import { useTabListKeyboard } from "../hooks/useTabListKeyboard"
import { api } from "../lib/api"
import { isNativeMultisig } from "../lib/nativeMultisig"
import { useBalance } from "../hooks/useBalance"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { StatusBadge } from "../components/ui/StatusBadge"
import { getMultisigStatus } from "../components/ui/txStatus"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { ErrorToast } from "../components/ui/ErrorToast"
import type { Transaction } from "../gen/memba/v1/memba_pb"
import { ExecutionState } from "../gen/memba/v1/memba_pb"
import { ENABLE_NATIVE_GNO_MULTISIG, GNO_CHAIN_ID, GNO_BECH32_PREFIX } from "../lib/config"
import { revealInvisibleFormatting } from "../lib/dao/v2Text"
import type { LayoutContext } from "../types/layout"
import "./multisigview.css"

// Tab keys in display order — shared by the tablist markup and the keyboard hook.
const TX_TAB_KEYS = ["pending", "executed"] as const
const TX_PAGE_LIMIT = 50

export function MultisigView() {
    const { address } = useParams<{ address: string }>()
    const navigate = useNetworkNav()
    const queryClient = useQueryClient()
    const { auth } = useOutletContext<LayoutContext>()
    const token = auth.token

    const [txTab, setTxTab] = useState<"pending" | "executed">("pending")

    // APG tabs keyboard contract (roving tabindex, arrows, Home/End) — the
    // shared hook Directory extracted; these tabs had no keyboard support.
    const { tabProps } = useTabListKeyboard<"pending" | "executed">({
        keys: TX_TAB_KEYS,
        active: txTab,
        onSelect: setTxTab,
        idFor: (k) => `msview-tab-${k}`,
    })
    const [copied, setCopied] = useState(false)
    const [editing, setEditing] = useState(false)
    const [editName, setEditName] = useState("")

    const { balance } = useBalance(address || null)

    // Read identity and the two lists independently, so a failed history
    // request does not hide account details or the other transaction tab.
    const enabled = !!token && !!address && auth.isAuthenticated
    const key = [GNO_CHAIN_ID, address ?? "", token?.userAddress ?? ""]
    const infoQuery = useQuery({
        queryKey: ["multisig", "view-info", ...key],
        enabled,
        queryFn: async () => (await api.multisigInfo({ authToken: token!, multisigAddress: address!, chainId: GNO_CHAIN_ID })).multisig ?? null,
    })
    const pendingQuery = useQuery({
        queryKey: ["multisig", "view-pending", ...key],
        enabled,
        queryFn: async () => (await api.transactions({ authToken: token!, multisigAddress: address!, chainId: GNO_CHAIN_ID, executionState: ExecutionState.PENDING, limit: TX_PAGE_LIMIT })).transactions,
    })
    const executedQuery = useQuery({
        queryKey: ["multisig", "view-executed", ...key],
        enabled,
        queryFn: async () => (await api.transactions({ authToken: token!, multisigAddress: address!, chainId: GNO_CHAIN_ID, executionState: ExecutionState.EXECUTED, limit: TX_PAGE_LIMIT })).transactions,
    })
    const multisig = infoQuery.data ?? null
    const pendingTxs = pendingQuery.data ?? []
    const executedTxs = executedQuery.data ?? []
    const nativeEnabled = !!multisig && ENABLE_NATIVE_GNO_MULTISIG && isNativeMultisig(multisig.pubkeyJson)

    // Rename errors stay local; failed reads appear beside the affected data.
    const [actionError, setActionError] = useState<string | null>(null)

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
                expectedMultisigAddress: multisig.address,
                name,
                bech32Prefix: GNO_BECH32_PREFIX,
            })
            setEditing(false)
            void queryClient.invalidateQueries({ queryKey: ["multisig"] })
        } catch (err) {
            setActionError(err instanceof Error ? err.message : "Rename failed")
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
    if (infoQuery.isPending) {
        return (
            <div className="animate-fade-in k-msview">
                <button className="k-msview__back" onClick={() => navigate("/")}>← Back to Dashboard</button>
                <SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
        )
    }

    if (!multisig) {
        return <div className="animate-fade-in k-msview">
            <button className="k-msview__back" onClick={() => navigate("/")}>← Back to Dashboard</button>
            <div className="k-card k-msview__empty" role="alert">
                <p>{infoQuery.isError ? "Could not load this multisig." : "This multisig was not found for your account."}</p>
                {infoQuery.isError && <button type="button" className="k-btn-secondary" onClick={() => void infoQuery.refetch()}>Retry account details</button>}
            </div>
        </div>
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
                                    aria-label="Multisig name"
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
                            <div className="k-msview__title-row">
                                <h2 className="k-msview__title">{revealInvisibleFormatting(multisig.name || "Multisig Wallet")}</h2>
                                <button type="button" className="k-msview__title-edit" aria-label="Rename multisig" onClick={() => { setEditName(multisig.name || ""); setEditing(true) }}>Rename</button>
                            </div>
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
                                    shareUrl = `${origin}/import?pubkey=${encodeURIComponent(encoded)}&name=${name}&address=${encodeURIComponent(multisig.address)}&chain=${encodeURIComponent(multisig.chainId || GNO_CHAIN_ID)}`
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
                        <button className="k-btn-primary" disabled={!nativeEnabled} onClick={() => navigate(`/multisig/${address}/propose`)} aria-label="Propose a new transaction">
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
                {!nativeEnabled && <p className="k-msview__availability" role="status">{isNativeMultisig(multisig.pubkeyJson) ? "Native signing and broadcasting are on hold pending release approval." : "Legacy multisig records are read-only history. They cannot be executed on Gno from Memba."}</p>}
            </div>

            {/* ── Action Required Banner ───────────────────── */}
            {infoQuery.isError && <div className="k-card k-msview__empty" role="alert"><p>Could not refresh account details. Showing the last loaded details.</p><button type="button" className="k-btn-secondary" onClick={() => void infoQuery.refetch()}>Retry account details</button></div>}
            {(() => {
                if (!nativeEnabled || !pendingQuery.isSuccess) return null
                const userAddr = token?.userAddress || (auth as { address?: string }).address || ""
                const unsignedCount = pendingTxs.filter(tx =>
                    !tx.signatures.some(s => s.userAddress === userAddr)
                ).length
                if (unsignedCount === 0) return null
                return (
                    <div className="k-msview__action-banner">
                        <span style={{ fontSize: "var(--pro-body, 14px)" }}>⚡</span>
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
                <div className="k-card" aria-live="polite">
                    <p className="k-label">Balance</p>
                    <p className="k-value">{balance}</p>
                </div>
                <div className="k-card">
                    <p className="k-label">Pending TX</p>
                    <p className="k-value">{pendingQuery.isError ? "—" : pendingQuery.isPending ? "Loading…" : pendingTxs.length >= TX_PAGE_LIMIT ? `${TX_PAGE_LIMIT}+` : pendingTxs.length}</p>
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
                <div className="k-msview__tabs" role="tablist" aria-label="Transaction status">
                    <button
                        {...tabProps("pending")}
                        className={`k-msview__tab ${txTab === "pending" ? "k-msview__tab--active" : ""}`}
                        onClick={() => setTxTab("pending")}
                    >
                        Pending ({pendingQuery.isError ? "unavailable" : pendingQuery.isPending ? "…" : pendingTxs.length >= TX_PAGE_LIMIT ? `${TX_PAGE_LIMIT}+` : pendingTxs.length})
                    </button>
                    <button
                        {...tabProps("executed")}
                        className={`k-msview__tab ${txTab === "executed" ? "k-msview__tab--active" : ""}`}
                        onClick={() => setTxTab("executed")}
                    >
                        Completed ({executedQuery.isError ? "unavailable" : executedQuery.isPending ? "…" : executedTxs.length >= TX_PAGE_LIMIT ? `${TX_PAGE_LIMIT}+` : executedTxs.length})
                    </button>
                </div>
                {(() => {
                    const query = txTab === "pending" ? pendingQuery : executedQuery
                    if (query.isPending) return <p className="k-msview__history-note" role="status">Loading {txTab} transactions…</p>
                    if (query.isError && !query.data) return <div className="k-card k-msview__empty" role="alert"><p>Could not load {txTab} transactions.</p><button type="button" className="k-btn-secondary" onClick={() => void query.refetch()}>Retry {txTab} transactions</button></div>
                    const txs = query.data ?? []
                    return <>{query.isError && <p className="k-msview__history-note" role="alert">Could not refresh {txTab} transactions. Showing the last loaded list. <button type="button" className="k-btn-secondary" onClick={() => void query.refetch()}>Retry</button></p>}{txs.length >= TX_PAGE_LIMIT && <p className="k-msview__history-note" role="status">Showing the newest {TX_PAGE_LIMIT} {txTab} transactions. Older transactions may be hidden.</p>}{renderTxList(txs, txTab === "pending" ? "No pending transactions" : "No completed transactions")}</>
                })()}
            </div>

            <ErrorToast message={actionError} onDismiss={() => setActionError(null)} />
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
                    const status = getMultisigStatus(tx)
                    return (
                        <button type="button"
                            key={tx.id}
                            className="k-activity-row k-msview__tx-row"
                            onClick={() => navigate(`/tx/${tx.id}?ms=${address}&chain=${GNO_CHAIN_ID}`)}
                            aria-label={`Open transaction #${tx.id}, ${tx.type || "send"}`}
                        >
                            <span className="k-msview__tx-type">{tx.type || "send"}</span>
                            <span><StatusBadge status={status} sigCount={tx.signatures.length} threshold={tx.threshold} /></span>
                            <span className="k-msview__tx-date">{formatDate(tx.createdAt)}</span>
                        </button>
                    )
                })}
            </div>
        )
    }
}
