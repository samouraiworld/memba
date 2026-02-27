import { useState, useEffect, useCallback } from "react"
import { useNavigate, useParams, useOutletContext } from "react-router-dom"
import { ErrorToast } from "../components/ui/ErrorToast"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { GNO_RPC_URL } from "../lib/config"
import { getDAOConfig, getDAOMembers, type DAOConfig, type DAOMember } from "../lib/dao"
import { getTokenBalance, listFactoryTokens, type TokenInfo } from "../lib/grc20"
import { decodeSlug } from "../lib/daoSlug"
import type { LayoutContext } from "../types/layout"

interface TreasuryAsset {
    type: "gnot" | "grc20"
    symbol: string
    name: string
    balance: string
    rawBalance: bigint
}

export function Treasury() {
    const navigate = useNavigate()
    const { slug } = useParams<{ slug: string }>()
    const { auth, adena } = useOutletContext<LayoutContext>()

    const realmPath = slug ? decodeSlug(slug) : ""

    const [config, setConfig] = useState<DAOConfig | null>(null)
    const [members, setMembers] = useState<DAOMember[]>([])
    const [assets, setAssets] = useState<TreasuryAsset[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const loadTreasury = useCallback(async () => {
        if (!realmPath) return
        setLoading(true)
        setError(null)
        try {
            const [cfg, mems] = await Promise.all([
                getDAOConfig(GNO_RPC_URL, realmPath),
                getDAOMembers(GNO_RPC_URL, realmPath),
            ])
            setConfig(cfg)
            setMembers(mems)

            const tokens = await listFactoryTokens(GNO_RPC_URL)
            const daoAddress = realmPath.replace("gno.land/r/", "").replace(/\//g, "")

            const results = await Promise.allSettled(
                tokens.map(async (token: TokenInfo) => {
                    const balance = await getTokenBalance(GNO_RPC_URL, token.symbol, daoAddress)
                    return { token, balance }
                })
            )
            const treasuryAssets: TreasuryAsset[] = results
                .filter((r): r is PromiseFulfilledResult<{ token: TokenInfo; balance: bigint }> =>
                    r.status === "fulfilled" && r.value.balance > 0n
                )
                .map((r) => ({
                    type: "grc20" as const,
                    symbol: r.value.token.symbol,
                    name: r.value.token.name,
                    balance: String(r.value.balance),
                    rawBalance: r.value.balance,
                }))

            setAssets(treasuryAssets)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load treasury data")
        } finally {
            setLoading(false)
        }
    }, [realmPath])

    useEffect(() => { loadTreasury() }, [loadTreasury])

    const isCurrentUserMember = members.some((m) => m.address === adena.address)

    if (loading) {
        return (
            <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
            </div>
        )
    }

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            {/* Nav */}
            <button
                id="treasury-back-btn"
                aria-label="Back to DAO"
                onClick={() => navigate(`/dao/${slug}`)}
                style={{ color: "#00d4aa", fontSize: 13, background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace", textAlign: "left" }}
            >
                ← Back to DAO
            </button>

            {/* Header */}
            <div>
                <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
                    💰 Treasury
                </h2>
                <p style={{ color: "#888", fontSize: 12, marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                    {config?.name || "DAO"} treasury overview
                </p>
            </div>

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                <StatCard label="Total Assets" value={String(assets.length)} icon="🪙" accent />
                <StatCard label="GRC20 Tokens" value={String(assets.filter((a) => a.type === "grc20").length)} icon="💎" />
                <StatCard label="Members" value={String(members.length)} icon="👥" />
            </div>

            {/* Assets Table */}
            <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f0f0f0" }}>Assets</h3>
                    {auth.isAuthenticated && isCurrentUserMember && (
                        <button
                            className="k-btn-primary"
                            onClick={() => navigate(`/dao/${slug}/treasury/propose`)}
                            style={{ fontSize: 12, padding: "8px 16px" }}
                        >
                            + Propose Spend
                        </button>
                    )}
                </div>

                {assets.length === 0 ? (
                    <div className="k-dashed" style={{ background: "#0c0c0c", padding: 32, textAlign: "center" }}>
                        <p style={{ color: "#555", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
                            No assets found in treasury
                        </p>
                        <p style={{ color: "#444", fontSize: 11, marginTop: 8, fontFamily: "JetBrains Mono, monospace" }}>
                            Assets will appear once tokens are transferred to the DAO
                        </p>
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {/* Header */}
                        <div style={{
                            display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                            padding: "8px 20px", fontSize: 10, color: "#555",
                            fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase",
                            letterSpacing: "0.05em", borderBottom: "1px solid #1a1a1a",
                        }}>
                            <span>Asset</span>
                            <span>Symbol</span>
                            <span style={{ textAlign: "right" }}>Balance</span>
                        </div>

                        {/* Rows */}
                        {assets.map((asset) => (
                            <div
                                key={`${asset.type}-${asset.symbol}`}
                                className="k-card"
                                style={{
                                    display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                                    padding: "14px 20px", alignItems: "center",
                                    cursor: asset.type === "grc20" ? "pointer" : "default",
                                    transition: "border-color 0.15s",
                                }}
                                onClick={() => asset.type === "grc20" && navigate(`/tokens/${asset.symbol}`)}
                                onMouseEnter={(e) => e.currentTarget.style.borderColor = "#333"}
                                onMouseLeave={(e) => e.currentTarget.style.borderColor = ""}
                            >
                                <span style={{ fontSize: 13, fontWeight: 500, color: "#f0f0f0" }}>
                                    {asset.name}
                                </span>
                                <span style={{
                                    fontSize: 11, fontFamily: "JetBrains Mono, monospace",
                                    color: asset.type === "grc20" ? "#00d4aa" : "#f5a623",
                                }}>
                                    {asset.type === "grc20" ? `$${asset.symbol}` : asset.symbol}
                                </span>
                                <span style={{
                                    textAlign: "right", fontSize: 14, fontWeight: 700,
                                    fontFamily: "JetBrains Mono, monospace", color: "#f0f0f0",
                                }}>
                                    {formatBalance(asset.rawBalance)}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

// ── Components ────────────────────────────────────────────

function StatCard({ label, value, icon, accent }: { label: string; value: string; icon: string; accent?: boolean }) {
    return (
        <div className="k-card" style={{ padding: "16px 18px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 22 }}>{icon}</span>
            <div>
                <div style={{
                    fontSize: 20, fontWeight: 700,
                    color: accent ? "#00d4aa" : "#f0f0f0",
                    fontFamily: "JetBrains Mono, monospace",
                }}>
                    {value}
                </div>
                <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "JetBrains Mono, monospace" }}>
                    {label}
                </div>
            </div>
        </div>
    )
}

// ── Helpers ────────────────────────────────────────────────

function formatBalance(balance: bigint): string {
    if (balance === 0n) return "0"
    const str = String(balance)
    return str.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}
