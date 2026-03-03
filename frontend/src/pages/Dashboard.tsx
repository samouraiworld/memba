import { useEffect, useState, useCallback } from "react"
import { useNavigate, useOutletContext } from "react-router-dom"
import { api } from "../lib/api"
import { StatusBadge } from "../components/ui/StatusBadge"
import { getTxStatus } from "../components/ui/txStatus"
import { SkeletonCard, SkeletonRow } from "../components/ui/LoadingSkeleton"
import { ErrorToast } from "../components/ui/ErrorToast"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import type { Multisig, Transaction } from "../gen/memba/v1/memba_pb"
import { ExecutionState } from "../gen/memba/v1/memba_pb"
import { GNO_CHAIN_ID, GNO_BECH32_PREFIX, GNO_RPC_URL } from "../lib/config"
import { exportTransactionsCSV, type ExportableTransaction } from "../lib/txExport"
import { queryRender } from "../lib/dao/shared"
import { fetchBackendProfile } from "../lib/profile"
import type { LayoutContext } from "../types/layout"

export function Dashboard() {
    const navigate = useNavigate()
    const { balance, auth } = useOutletContext<LayoutContext>()
    const token = auth.token

    const [multisigs, setMultisigs] = useState<Multisig[]>([])
    const [pendingTxs, setPendingTxs] = useState<Transaction[]>([])
    const [recentTxs, setRecentTxs] = useState<Transaction[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [joiningAddr, setJoiningAddr] = useState<string | null>(null)
    // User identity (from on-chain profile)
    const [username, setUsername] = useState<string | null>(null)
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

    const joinedMultisigs = multisigs.filter(m => m.joined)
    const discoverableMultisigs = multisigs.filter(m => !m.joined)

    const fetchData = useCallback(async () => {
        if (!token || !auth.isAuthenticated) return
        setLoading(true)
        setError(null)
        try {
            // P1-A: All-or-nothing — either all succeed or previous state is preserved.
            const [msRes, pendRes, recentRes] = await Promise.all([
                api.multisigs({ authToken: token, limit: 50 }),
                api.transactions({ authToken: token, executionState: ExecutionState.PENDING, limit: 10 }),
                api.transactions({ authToken: token, limit: 10 }),
            ])
            // Atomic state update — only reached if all three RPCs succeed.
            setMultisigs(msRes.multisigs)
            setPendingTxs(pendRes.transactions)
            setRecentTxs(recentRes.transactions)
        } catch (err) {
            // On failure, previous state is preserved (no partial updates).
            setError(err instanceof Error ? err.message : "Failed to load data")
        } finally {
            setLoading(false)
        }
    }, [token, auth.isAuthenticated])

    useEffect(() => { fetchData() }, [fetchData])

    // Fetch on-chain username + avatar for the identity card
    useEffect(() => {
        if (!auth.isAuthenticated || !balance) return
        const addr = (auth as { address?: string }).address
        if (!addr) return
        // Username from on-chain registry
        queryRender(GNO_RPC_URL, "gno.land/r/gnoland/users/v1", addr)
            .then((data) => {
                if (!data) return
                const m = data.match(/# User - `([^`]+)`/)
                if (m) setUsername(`@${m[1]}`)
            })
            .catch(() => { /* silent */ })
        // Avatar from backend profile
        fetchBackendProfile(addr)
            .then((p) => { if (p?.avatarUrl) setAvatarUrl(p.avatarUrl) })
            .catch(() => { /* silent */ })
    }, [auth.isAuthenticated, balance, auth])

    // S1: Clear stale data when auth drops (wallet disconnect / token expiry)
    useEffect(() => {
        if (!auth.isAuthenticated) {
            setMultisigs([])
            setPendingTxs([])
            setRecentTxs([])
        }
    }, [auth.isAuthenticated])

    const formatDate = (dateStr: string) => {
        try {
            return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        } catch { return dateStr }
    }

    const handleJoinMultisig = async (ms: Multisig) => {
        if (!token || !ms.pubkeyJson) return
        setJoiningAddr(ms.address)
        try {
            await api.createOrJoinMultisig({
                authToken: token,
                chainId: ms.chainId || GNO_CHAIN_ID,
                multisigPubkeyJson: ms.pubkeyJson,
                name: ms.name || "",
                bech32Prefix: GNO_BECH32_PREFIX,
            })
            fetchData() // refresh
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to join multisig")
        } finally {
            setJoiningAddr(null)
        }
    }

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            {/* ── User Identity Card (new) ────────────────────────── */}
            {auth.isAuthenticated && (
                <div className="k-card" style={{
                    padding: "20px 24px", display: "flex", alignItems: "center", gap: 16,
                    borderColor: "rgba(0,212,170,0.15)",
                    background: "linear-gradient(135deg, rgba(0,212,170,0.04), transparent)",
                }}>
                    <div
                        style={{
                            width: 48, height: 48, borderRadius: "50%",
                            background: avatarUrl ? "none" : "rgba(0,212,170,0.1)",
                            border: "2px solid rgba(0,212,170,0.2)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            overflow: "hidden", cursor: "pointer",
                        }}
                        onClick={() => navigate(`/profile/${(auth as { address?: string }).address || ""}`)}
                    >
                        {avatarUrl ? (
                            <img src={avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={() => setAvatarUrl(null)} />
                        ) : (
                            <span style={{ fontSize: 24 }}>👤</span>
                        )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 16, fontWeight: 600 }}>
                                {username || "Anonymous"}
                            </span>
                            <span style={{ fontSize: 14, fontWeight: 600, color: balance.startsWith("?") ? "#f5a623" : "#00d4aa" }}>
                                {balance}
                            </span>
                        </div>
                        <CopyableAddress address={(auth as { address?: string }).address || ""} fontSize={11} />
                    </div>
                    <button
                        className="k-btn-secondary"
                        onClick={() => navigate(`/profile/${(auth as { address?: string }).address || ""}`)}
                        style={{ fontSize: 11, flexShrink: 0 }}
                    >
                        Edit Profile
                    </button>
                </div>
            )}

            {/* ── Page header ────────────────────────────────────────── */}
            <div>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Dashboard</h2>
                <p style={{ color: "#999", fontSize: 14, marginTop: 4 }}>
                    Your hub for multisig wallets, DAOs, and tokens
                </p>
            </div>

            {/* ── Stat cards ─────────────────────────────────────────── */}
            <div className="k-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                {loading ? (
                    <>
                        <SkeletonCard />
                        <SkeletonCard />
                        <SkeletonCard />
                    </>
                ) : (
                    <>
                        <StatCard label="Multisigs" value={auth.isAuthenticated ? String(joinedMultisigs.length) : "—"} />
                        <StatCard label="Pending TX" value={auth.isAuthenticated ? String(pendingTxs.length) : "—"} accent />
                        <StatCard label="Balance" value={auth.isAuthenticated ? balance : "— GNOT"} />
                    </>
                )}
            </div>

            {/* ── Empty state / Quick actions ────────────────────────── */}
            {!auth.isAuthenticated ? (
                <div className="k-dashed" style={{ background: "#0c0c0c", padding: 48, textAlign: "center" }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(0,212,170,0.06)", border: "1px dashed rgba(0,212,170,0.3)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                        <span style={{ fontSize: 24 }}>🔗</span>
                    </div>
                    <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>Connect your wallet</h3>
                    <p style={{ color: "#666", fontSize: 13, maxWidth: 360, margin: "0 auto 20px", fontFamily: "JetBrains Mono, monospace" }}>
                        Connect Adena to create or import multisig wallets
                    </p>
                </div>
            ) : joinedMultisigs.length === 0 && discoverableMultisigs.length === 0 && !loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                    {/* Hero */}
                    <div style={{ textAlign: "center", padding: "32px 16px 16px" }}>
                        <div style={{ fontSize: 40, marginBottom: 12 }}>👋</div>
                        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Welcome to Memba</h3>
                        <p style={{ color: "#666", fontSize: 13, maxWidth: 420, margin: "0 auto", fontFamily: "JetBrains Mono, monospace", lineHeight: 1.6 }}>
                            Your gateway to Gno multisig wallets, DAO governance, and token management
                        </p>
                    </div>
                    {/* Feature Cards */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                        {[
                            { icon: "🔐", title: "Multisig Wallet", desc: "Create or import a shared wallet with threshold signing", cta: "Create Multisig", path: "/create", alt: "Import", altPath: "/import" },
                            { icon: "🏛️", title: "DAO Governance", desc: "Explore DAOs, vote on proposals, or create your own", cta: "Explore DAOs", path: "/dao" },
                            { icon: "🪙", title: "Token Factory", desc: "Create and manage GRC20 tokens on gno.land", cta: "Create Token", path: "/create-token" },
                        ].map((f) => (
                            <div
                                key={f.title}
                                className="k-card"
                                style={{
                                    padding: "24px 20px", display: "flex", flexDirection: "column", gap: 14,
                                    cursor: "pointer", transition: "border-color 0.2s, transform 0.2s",
                                }}
                                onClick={() => navigate(f.path)}
                                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,212,170,0.3)"; e.currentTarget.style.transform = "translateY(-2px)" }}
                                onMouseLeave={(e) => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.transform = "" }}
                            >
                                <span style={{ fontSize: 28 }}>{f.icon}</span>
                                <div>
                                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{f.title}</div>
                                    <p style={{ color: "#666", fontSize: 11, fontFamily: "JetBrains Mono, monospace", lineHeight: 1.5, margin: 0 }}>
                                        {f.desc}
                                    </p>
                                </div>
                                <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                                    <button className="k-btn-primary" style={{ fontSize: 11, padding: "6px 14px" }} onClick={(e) => { e.stopPropagation(); navigate(f.path) }}>
                                        {f.cta} →
                                    </button>
                                    {f.alt && f.altPath && (
                                        <button className="k-btn-secondary" style={{ fontSize: 11, padding: "6px 14px" }} onClick={(e) => { e.stopPropagation(); navigate(f.altPath) }}>
                                            {f.alt}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            {/* ── Discoverable Multisigs (auto-detect) ─────────────── */}
            {auth.isAuthenticated && discoverableMultisigs.length > 0 && (
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                        <span style={{ fontSize: 14 }}>🔍</span>
                        <h3 style={{ fontSize: 16, fontWeight: 500 }}>Discovered Multisigs</h3>
                        <span className="k-label" style={{ marginLeft: "auto" }}>{discoverableMultisigs.length} found</span>
                    </div>
                    <p style={{ color: "#888", fontSize: 12, fontFamily: "JetBrains Mono, monospace", marginBottom: 12 }}>
                        These multisigs include your address as a member. Join to manage them.
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
                        {discoverableMultisigs.map(ms => (
                            <div key={ms.address} className="k-card" style={{ borderColor: "rgba(245,158,11,0.2)", display: "flex", flexDirection: "column", gap: 8 }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ fontWeight: 600, fontSize: 14 }}>{ms.name || "Unnamed"}</span>
                                    <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#f59e0b", background: "rgba(245,158,11,0.1)", padding: "2px 6px", borderRadius: 4 }}>
                                        {ms.threshold}/{ms.membersCount}
                                    </span>
                                </div>
                                <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#666", wordBreak: "break-all" }}>
                                    <CopyableAddress address={ms.address} />
                                </span>
                                <button
                                    className="k-btn-primary"
                                    disabled={joiningAddr === ms.address}
                                    onClick={() => handleJoinMultisig(ms)}
                                    style={{ alignSelf: "flex-start", marginTop: 4, opacity: joiningAddr === ms.address ? 0.5 : 1 }}
                                >
                                    {joiningAddr === ms.address ? "Joining..." : "✓ Join Multisig"}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Your Multisigs ────────────────────────────────────── */}
            {auth.isAuthenticated && joinedMultisigs.length > 0 && (
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00d4aa" }} className="animate-glow" />
                        <h3 style={{ fontSize: 16, fontWeight: 500 }}>Your Multisigs</h3>
                        <span className="k-label" style={{ marginLeft: "auto" }}>{joinedMultisigs.length} active</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
                        {joinedMultisigs.map(ms => (
                            <div
                                key={ms.address}
                                className="k-card"
                                onClick={() => navigate(`/multisig/${ms.address}`)}
                                style={{ cursor: "pointer", transition: "border-color 0.15s" }}
                                onMouseEnter={(e) => e.currentTarget.style.borderColor = "rgba(0,212,170,0.3)"}
                                onMouseLeave={(e) => e.currentTarget.style.borderColor = ""}
                            >
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                                    <span style={{ fontWeight: 600, fontSize: 14 }}>{ms.name || "Unnamed"}</span>
                                    <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#00d4aa", background: "rgba(0,212,170,0.08)", padding: "2px 6px", borderRadius: 4 }}>
                                        {ms.threshold}/{ms.membersCount}
                                    </span>
                                </div>
                                <CopyableAddress address={ms.address} />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Quick Actions ───────────────────────────────────── */}
            {auth.isAuthenticated && (joinedMultisigs.length > 0 || discoverableMultisigs.length > 0) && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button className="k-btn-primary" onClick={() => navigate("/create")} style={{ fontSize: 12 }}>
                        + Multisig
                    </button>
                    <button className="k-btn-secondary" onClick={() => navigate("/import")} style={{ fontSize: 12 }}>
                        Import
                    </button>
                    <button
                        className="k-btn-secondary"
                        onClick={() => navigate("/dao")}
                        style={{ fontSize: 12, borderColor: "rgba(99,102,241,0.3)", color: "#818cf8" }}
                    >
                        🏛️ Explore DAOs
                    </button>
                    <button
                        className="k-btn-secondary"
                        onClick={() => navigate("/dao/create")}
                        style={{ fontSize: 12, borderColor: "rgba(99,102,241,0.3)", color: "#818cf8" }}
                    >
                        + Create DAO
                    </button>
                    <button
                        className="k-btn-secondary"
                        onClick={() => navigate("/create-token")}
                        style={{ fontSize: 12, borderColor: "rgba(245,166,35,0.3)", color: "#f5a623" }}
                    >
                        🪙 Create Token
                    </button>
                    <button
                        className="k-btn-secondary"
                        onClick={() => navigate("/tokens")}
                        style={{ fontSize: 12, borderColor: "rgba(245,166,35,0.3)", color: "#f5a623" }}
                    >
                        Browse Tokens
                    </button>
                </div>
            )}

            {/* ── Pending Transactions ───────────────────────────────── */}
            {auth.isAuthenticated && (
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00d4aa" }} className="animate-glow" />
                        <h3 style={{ fontSize: 16, fontWeight: 500 }}>Pending Transactions</h3>
                        <span className="k-label" style={{ marginLeft: "auto" }}>{pendingTxs.length} pending</span>
                    </div>
                    {loading ? (
                        <div className="k-card" style={{ padding: 0, overflow: "hidden" }}>
                            <SkeletonRow />
                            <SkeletonRow />
                        </div>
                    ) : pendingTxs.length === 0 ? (
                        <div className="k-card" style={{ textAlign: "center", padding: 32 }}>
                            <p style={{ color: "#555", fontSize: 14, fontFamily: "JetBrains Mono, monospace" }}>
                                No pending transactions
                            </p>
                        </div>
                    ) : (
                        <div className="k-card" style={{ padding: 0, overflow: "hidden" }}>
                            {pendingTxs.map((tx) => {
                                const status = getTxStatus(tx.finalHash, tx.signatures.length, tx.threshold)
                                return (
                                    <div
                                        key={tx.id}
                                        onClick={() => navigate(`/tx/${tx.id}`)}
                                        className="k-activity-row"
                                        style={{
                                            display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto",
                                            padding: "14px 20px", borderBottom: "1px solid #1a1a1a",
                                            cursor: "pointer", transition: "background 0.15s",
                                            fontSize: 13, fontFamily: "JetBrains Mono, monospace",
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = "#0c0c0c"}
                                        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                                    >
                                        <span style={{ color: "#f0f0f0", textTransform: "capitalize" }}>{tx.type || "send"}</span>
                                        <span className="k-activity-hide-mobile"><CopyableAddress address={tx.multisigAddress} full={false} /></span>
                                        <span><StatusBadge status={status} sigCount={tx.signatures.length} threshold={tx.threshold} /></span>
                                        <span style={{ color: "#555", fontSize: 11 }}>{formatDate(tx.createdAt)}</span>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* ── Recent Activity ────────────────────────────────────────── */}
            {auth.isAuthenticated && (
                <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                        <h3 style={{ fontSize: 16, fontWeight: 500 }}>Recent Activity</h3>
                        {recentTxs.length > 0 && (
                            <button
                                onClick={() => {
                                    const exportable: ExportableTransaction[] = recentTxs.map((tx) => ({
                                        id: tx.id,
                                        createdAt: tx.createdAt,
                                        type: tx.type,
                                        multisigAddress: tx.multisigAddress,
                                        creatorAddress: tx.creatorAddress,
                                        memo: tx.memo,
                                        finalHash: tx.finalHash,
                                        threshold: tx.threshold,
                                        signatures: tx.signatures.map((s) => ({ userAddress: s.userAddress })),
                                        msgsJson: tx.msgsJson,
                                    }))
                                    exportTransactionsCSV(exportable)
                                }}
                                style={{
                                    background: "rgba(0,212,170,0.06)", border: "1px solid rgba(0,212,170,0.15)",
                                    color: "#00d4aa", fontSize: 10, fontFamily: "JetBrains Mono, monospace",
                                    padding: "4px 10px", borderRadius: 4, cursor: "pointer",
                                }}
                            >
                                📥 Export CSV
                            </button>
                        )}
                    </div>
                    {loading ? (
                        <div className="k-card" style={{ padding: 0, overflow: "hidden" }}>
                            <SkeletonRow />
                            <SkeletonRow />
                            <SkeletonRow />
                        </div>
                    ) : recentTxs.length === 0 ? (
                        <div className="k-card" style={{ padding: 0, overflow: "hidden" }}>
                            <div className="k-activity-header" style={{
                                padding: "12px 20px", borderBottom: "1px solid #222",
                                display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto",
                                fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#555",
                                textTransform: "uppercase", letterSpacing: "0.05em",
                            }}>
                                <span>Type</span>
                                <span>Multisig</span>
                                <span>Status</span>
                                <span>Date</span>
                            </div>
                            <div style={{ padding: 32, textAlign: "center" }}>
                                <p style={{ color: "#555", fontSize: 14, fontFamily: "JetBrains Mono, monospace" }}>
                                    No activity yet
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="k-card" style={{ padding: 0, overflow: "hidden" }}>
                            <div className="k-activity-header" style={{
                                padding: "12px 20px", borderBottom: "1px solid #222",
                                display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto",
                                fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#555",
                                textTransform: "uppercase", letterSpacing: "0.05em",
                            }}>
                                <span>Type</span>
                                <span>Multisig</span>
                                <span>Status</span>
                                <span>Date</span>
                            </div>
                            {recentTxs.map((tx) => {
                                const status = getTxStatus(tx.finalHash, tx.signatures.length, tx.threshold)
                                return (
                                    <div
                                        key={tx.id}
                                        onClick={() => navigate(`/tx/${tx.id}`)}
                                        className="k-activity-row"
                                        style={{
                                            display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto",
                                            padding: "14px 20px", borderBottom: "1px solid #1a1a1a",
                                            cursor: "pointer", transition: "background 0.15s",
                                            fontSize: 13, fontFamily: "JetBrains Mono, monospace",
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = "#0c0c0c"}
                                        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                                    >
                                        <span style={{ color: "#f0f0f0", textTransform: "capitalize" }}>{tx.type || "send"}</span>
                                        <span><CopyableAddress address={tx.multisigAddress} full={false} /></span>
                                        <span>
                                            <StatusBadge status={status} sigCount={tx.signatures.length} threshold={tx.threshold} hash={tx.finalHash} />
                                        </span>
                                        <span style={{ color: "#555", fontSize: 11 }}>{formatDate(tx.createdAt)}</span>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
    return (
        <div className={`k-card ${accent ? "k-card-accent" : ""}`}>
            <p className="k-label">{label}</p>
            <p className={`k-value ${accent ? "k-value-accent" : ""}`}>{value}</p>
        </div>
    )
}
