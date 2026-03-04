import { useState, useEffect, useCallback, useMemo } from "react"
import { useNavigate, useOutletContext } from "react-router-dom"
import { ErrorToast } from "../components/ui/ErrorToast"
import { SkeletonCard } from "../components/ui/LoadingSkeleton"
import { GNO_RPC_URL, getExplorerBaseUrl } from "../lib/config"
import { getDAOConfig, type DAOConfig } from "../lib/dao"
import {
    FEATURED_DAO,
    encodeSlug,
    getSavedDAOs,
    addSavedDAO,
    removeSavedDAO,
    validateRealmPath,
} from "../lib/daoSlug"
import { useUnvotedProposals } from "../hooks/useUnvotedProposals"
import type { LayoutContext } from "../types/layout"

interface DAOEntry {
    realmPath: string
    name: string
    config: DAOConfig | null
    featured?: boolean
}

export function DAOList() {
    const navigate = useNavigate()
    const { auth } = useOutletContext<LayoutContext>()

    const [daoEntries, setDaoEntries] = useState<DAOEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Connect form — collapsed by default
    const [showConnect, setShowConnect] = useState(false)
    const [realmInput, setRealmInput] = useState("")
    const [connecting, setConnecting] = useState(false)

    // Action Required: unvoted proposals
    const userAddress = auth.isAuthenticated ? (auth as { address?: string }).address || null : null
    const { proposals: unvotedProposals } = useUnvotedProposals(userAddress)

    // Per-DAO unvoted count for red dot on cards
    const unvotedByDao = useMemo(() => {
        const map = new Map<string, number>()
        for (const p of unvotedProposals) {
            map.set(p.realmPath, (map.get(p.realmPath) || 0) + 1)
        }
        return map
    }, [unvotedProposals])

    const loadDAOs = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const saved = getSavedDAOs()

            // Build unique list: featured + saved
            const allPaths = new Map<string, { name: string; featured: boolean }>()
            allPaths.set(FEATURED_DAO.realmPath, { name: FEATURED_DAO.name, featured: true })
            for (const s of saved) {
                if (!allPaths.has(s.realmPath)) {
                    allPaths.set(s.realmPath, { name: s.name, featured: false })
                }
            }

            // Immediately show placeholder cards (name + path, no config yet)
            const placeholders: DAOEntry[] = Array.from(allPaths.entries()).map(
                ([realmPath, meta]) => ({ realmPath, name: meta.name, config: null, featured: meta.featured }),
            )
            setDaoEntries(placeholders)
            setLoading(false)

            // Progressive: resolve each config independently, update cards as they arrive
            for (const [realmPath, meta] of allPaths) {
                getDAOConfig(GNO_RPC_URL, realmPath)
                    .then((config) => {
                        setDaoEntries((prev) =>
                            prev.map((entry) =>
                                entry.realmPath === realmPath
                                    ? { ...entry, name: config?.name || meta.name, config }
                                    : entry,
                            ),
                        )
                    })
                    .catch(() => {
                        // Card stays as placeholder — name/path still visible
                    })
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load DAOs")
            setLoading(false)
        }
    }, [])

    useEffect(() => { loadDAOs() }, [loadDAOs])

    const handleConnect = async () => {
        const path = realmInput.trim()
        if (!path) return
        const validationError = validateRealmPath(path)
        if (validationError) {
            setError(validationError)
            return
        }

        setConnecting(true)
        setError(null)
        try {
            const config = await getDAOConfig(GNO_RPC_URL, path)
            if (!config) {
                setError("No DAO found at this realm path. It may not be deployed yet.")
                return
            }
            addSavedDAO(path, config.name)
            setRealmInput("")
            navigate(`/dao/${encodeSlug(path)}`)
        } catch {
            setError("Could not connect to DAO realm. Please check the path.")
        } finally {
            setConnecting(false)
        }
    }

    const handleRemove = (realmPath: string) => {
        removeSavedDAO(realmPath)
        setDaoEntries((prev) => prev.filter((d) => d.realmPath !== realmPath || d.featured))
    }

    // Compute summary stats
    const totalMembers = daoEntries.reduce((sum, d) => sum + (d.config?.memberCount || 0), 0)

    return (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            {/* Header */}
            <div>
                <h2 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em" }}>
                    🏛️ DAO Governance
                </h2>
                <p style={{ color: "#888", fontSize: 13, marginTop: 6, fontFamily: "JetBrains Mono, monospace", maxWidth: 600 }}>
                    Browse proposals, vote, and manage DAO governance on gno.land
                </p>
            </div>

            {/* ── ⚡ Action Required Banner ──────────────────────── */}
            {unvotedProposals.length > 0 && (
                <div className="k-action-banner" style={{
                    display: "flex", flexDirection: "column", gap: 10,
                    padding: "14px 18px", borderRadius: 10,
                    background: "linear-gradient(135deg, rgba(245,166,35,0.06), rgba(245,166,35,0.02))",
                    border: "1px solid rgba(245,166,35,0.15)",
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 14 }}>⚡</span>
                        <span style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "#f5a623", fontWeight: 600 }}>
                            🗳️ {unvotedProposals.length} proposal{unvotedProposals.length > 1 ? "s" : ""} need{unvotedProposals.length === 1 ? "s" : ""} your vote
                        </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 26 }}>
                        {unvotedProposals.slice(0, 3).map(p => (
                            <div
                                key={`${p.realmPath}:${p.proposalId}`}
                                onClick={() => navigate(`/dao/${p.daoSlug}/proposal/${p.proposalId}`)}
                                style={{
                                    fontSize: 11, fontFamily: "JetBrains Mono, monospace",
                                    color: "#ccc", cursor: "pointer", display: "flex", gap: 8,
                                    padding: "4px 8px", borderRadius: 6,
                                    transition: "background 0.15s",
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = "rgba(245,166,35,0.06)"}
                                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                            >
                                <span style={{ color: "#f5a623", flexShrink: 0 }}>{p.daoName}</span>
                                <span style={{ color: "#888" }}>—</span>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    #{p.proposalId}: {p.proposalTitle}
                                </span>
                                <span style={{ color: "#f5a623", marginLeft: "auto", flexShrink: 0 }}>→</span>
                            </div>
                        ))}
                        {unvotedProposals.length > 3 && (
                            <span
                                onClick={() => navigate("/dao")}
                                style={{ fontSize: 10, color: "#888", cursor: "pointer", paddingLeft: 8 }}
                            >
                                +{unvotedProposals.length - 3} more…
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* ── Summary Line ───────────────────────────────────── */}
            {!loading && daoEntries.length > 0 && (
                <div style={{
                    display: "flex", gap: 16, fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#666",
                }}>
                    <span>{daoEntries.length} DAO{daoEntries.length !== 1 ? "s" : ""}</span>
                    <span>·</span>
                    <span>{unvotedProposals.length} pending vote{unvotedProposals.length !== 1 ? "s" : ""}</span>
                    {totalMembers > 0 && (
                        <>
                            <span>·</span>
                            <span>{totalMembers} member{totalMembers !== 1 ? "s" : ""} total</span>
                        </>
                    )}
                </div>
            )}

            {/* ── DAO Grid (MOVED UP — primary content) ────────── */}
            {loading ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
                    <SkeletonCard />
                    <SkeletonCard />
                </div>
            ) : daoEntries.length === 0 ? (
                <div className="k-dashed" style={{ background: "#0c0c0c", padding: 48, textAlign: "center" }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(0,212,170,0.06)", border: "1px dashed rgba(0,212,170,0.3)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                        <span style={{ fontSize: 24 }}>🏛️</span>
                    </div>
                    <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>No DAOs yet</h3>
                    <p style={{ color: "#666", fontSize: 13, maxWidth: 360, margin: "0 auto", fontFamily: "JetBrains Mono, monospace" }}>
                        Connect to a DAO by clicking below, or create your own
                    </p>
                </div>
            ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
                    {daoEntries.map((dao) => (
                        <DAOCard
                            key={dao.realmPath}
                            dao={dao}
                            unvotedCount={unvotedByDao.get(dao.realmPath) || 0}
                            onOpen={() => {
                                addSavedDAO(dao.realmPath, dao.name)
                                navigate(`/dao/${encodeSlug(dao.realmPath)}`)
                            }}
                            onRemove={dao.featured ? undefined : () => handleRemove(dao.realmPath)}
                        />
                    ))}
                </div>
            )}

            {/* ── Quick Actions ─────────────────────────────────── */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button
                    id="dao-create-btn"
                    className="k-btn-primary"
                    onClick={() => navigate("/dao/create")}
                    style={{ fontSize: 12 }}
                >
                    + Create a DAO
                </button>
                <button
                    className="k-btn-secondary"
                    onClick={() => setShowConnect(!showConnect)}
                    style={{ fontSize: 12 }}
                >
                    🔗 {showConnect ? "Hide" : "Connect to DAO"}
                </button>
            </div>

            {/* ── Connect Form (COLLAPSED by default) ──────────── */}
            {showConnect && (
                <div className="k-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 20 }}>🔗</span>
                        <div>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>Connect to a DAO</div>
                            <div style={{ fontSize: 11, color: "#666", fontFamily: "JetBrains Mono, monospace" }}>
                                Enter a DAO realm path to explore its governance
                            </div>
                        </div>
                    </div>

                    <div style={{ display: "flex", gap: 10 }}>
                        <input
                            id="dao-connect-input"
                            type="text"
                            value={realmInput}
                            onChange={(e) => setRealmInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                            placeholder="gno.land/r/your/dao"
                            maxLength={100}
                            disabled={connecting}
                            aria-label="DAO realm path"
                            style={{
                                flex: 1, height: 40, padding: "0 12px", borderRadius: 8,
                                background: "#0c0c0c", border: "1px solid #222", color: "#f0f0f0",
                                fontFamily: "JetBrains Mono, monospace", fontSize: 13, outline: "none",
                                opacity: connecting ? 0.5 : 1,
                            }}
                        />
                        <button
                            id="dao-connect-btn"
                            className="k-btn-primary"
                            onClick={handleConnect}
                            disabled={connecting || !realmInput.trim()}
                            style={{ whiteSpace: "nowrap", opacity: !realmInput.trim() ? 0.4 : 1 }}
                        >
                            {connecting ? "Connecting..." : "Connect"}
                        </button>
                    </div>
                </div>
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} />
        </div>
    )
}

// ── Components ────────────────────────────────────────────

function DAOCard({
    dao,
    unvotedCount,
    onOpen,
    onRemove,
}: {
    dao: DAOEntry
    unvotedCount: number
    onOpen: () => void
    onRemove?: () => void
}) {
    return (
        <div
            className="k-card"
            style={{
                padding: "20px 24px",
                display: "flex", flexDirection: "column", gap: 14,
                cursor: "pointer", transition: "border-color 0.15s",
                borderColor: dao.featured ? "rgba(0,212,170,0.15)" : undefined,
                opacity: dao.config?.isArchived ? 0.6 : 1,
            }}
            onClick={onOpen}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(0,212,170,0.3)")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = dao.featured ? "rgba(0,212,170,0.15)" : "")}
        >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 22 }}>🏛️</span>
                    <div>
                        <span style={{ fontWeight: 600, fontSize: 15, color: "#f0f0f0" }}>
                            {dao.name}
                        </span>
                        {dao.featured && (
                            <span style={{
                                marginLeft: 8, padding: "2px 6px", borderRadius: 4, fontSize: 9,
                                fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                background: "rgba(0,212,170,0.1)", color: "#00d4aa",
                            }}>
                                FEATURED
                            </span>
                        )}
                        {dao.config?.isArchived && (
                            <span style={{
                                marginLeft: 8, padding: "2px 6px", borderRadius: 4, fontSize: 9,
                                fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                background: "rgba(245,166,35,0.1)", color: "#f5a623",
                            }}>
                                📦 Archived
                            </span>
                        )}
                    </div>
                </div>
                {onRemove && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onRemove() }}
                        title="Remove"
                        aria-label={`Remove ${dao.name}`}
                        style={{
                            background: "none", border: "none", color: "#555",
                            cursor: "pointer", fontSize: 14, padding: 4,
                        }}
                    >
                        ×
                    </button>
                )}
            </div>

            {/* Unvoted indicator */}
            {unvotedCount > 0 && (
                <div style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "4px 10px", borderRadius: 6,
                    background: "rgba(245,166,35,0.06)",
                    border: "1px solid rgba(245,166,35,0.12)",
                }}>
                    <span style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: "#f5a623",
                        animation: "pulse 2s infinite",
                        display: "inline-block", flexShrink: 0,
                    }} />
                    <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#f5a623", fontWeight: 600 }}>
                        {unvotedCount} vote{unvotedCount > 1 ? "s" : ""} needed
                    </span>
                </div>
            )}

            {/* Realm path + source link */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#555", wordBreak: "break-all" }}>
                    {dao.realmPath}
                </div>
                <a
                    href={`${getExplorerBaseUrl()}/r/${dao.realmPath.replace("gno.land/r/", "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View source on gno.land"
                    style={{
                        fontSize: 9, fontFamily: "JetBrains Mono, monospace",
                        color: "#444", textDecoration: "none", transition: "color 0.15s",
                        padding: "1px 4px", borderRadius: 3,
                        border: "1px solid #222", flexShrink: 0,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#00d4aa")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#444")}
                    onClick={(e) => e.stopPropagation()}
                >
                    &lt;/&gt;
                </a>
            </div>

            {/* Stats */}
            {dao.config && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", gap: 16, fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}>
                        <span style={{ color: "#888" }}>
                            👥 {dao.config.memberCount} members
                        </span>
                        <span style={{ color: "#888" }}>
                            📊 {dao.config.threshold} threshold
                        </span>
                    </div>

                    {/* Tier distribution badges */}
                    {dao.config.tierDistribution && dao.config.tierDistribution.length > 0 && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {dao.config.tierDistribution.map((t) => {
                                const colors: Record<string, string> = { T1: "#00d4aa", T2: "#2196f3", T3: "#f5a623" }
                                const color = colors[t.tier] || "#888"
                                return (
                                    <span key={t.tier} style={{
                                        display: "flex", alignItems: "center", gap: 4,
                                        padding: "2px 8px", borderRadius: 4, fontSize: 9,
                                        fontFamily: "JetBrains Mono, monospace", fontWeight: 600,
                                        background: `${color}12`, color,
                                    }}>
                                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, display: "inline-block" }} />
                                        {t.tier}: {t.memberCount} • {t.power}pw
                                    </span>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Description */}
            {dao.config?.description && (
                <p style={{
                    color: "#666", fontSize: 12, fontFamily: "JetBrains Mono, monospace",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    maxWidth: 400,
                }}>
                    {dao.config.description}
                </p>
            )}

            {/* CTA */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <span style={{ color: "#00d4aa", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
                    Open →
                </span>
            </div>
        </div>
    )
}
