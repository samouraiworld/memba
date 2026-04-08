/**
 * Multisig Hub — Dedicated management overview for multisig wallets.
 *
 * Shows all user's multisig wallets (joined + discoverable) with:
 * - Name, address, threshold (K/N)
 * - Quick actions (view, create)
 * - Empty state with CTA
 *
 * Replaces the old redirect-to-dashboard behavior.
 */

import { useNetworkNav } from "../hooks/useNetworkNav"
import { useEffect, useCallback, useState } from "react"
import { useOutletContext } from "react-router-dom"
import { LockKey, Plus, MagnifyingGlass, Wallet, Users } from "@phosphor-icons/react"
import { api } from "../lib/api"
import { GNO_CHAIN_ID, GNO_BECH32_PREFIX } from "../lib/config"
import { CopyableAddress } from "../components/ui/CopyableAddress"
import { ErrorToast } from "../components/ui/ErrorToast"
import type { Multisig } from "../gen/memba/v1/memba_pb"
import type { LayoutContext } from "../types/layout"
import { logChainError } from "../lib/errorLog"
import "./multisig-hub.css"

export default function MultisigHub() {
    const navigate = useNetworkNav()
    const { auth } = useOutletContext<LayoutContext>()
    const token = auth.token

    const [multisigs, setMultisigs] = useState<Multisig[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [joiningAddr, setJoiningAddr] = useState<string | null>(null)

    const joined = multisigs.filter(m => m.joined)
    const discoverable = multisigs.filter(m => !m.joined)

    const fetchData = useCallback(async () => {
        if (!token || !auth.isAuthenticated) { setLoading(false); return }
        try {
            const res = await api.multisigs({ authToken: token, limit: 50 })
            setMultisigs(res.multisigs)
            setError(null)
        } catch (err) {
            const msg = err instanceof Error ? err.message : ""
            const isNet = /failed to fetch|networkerror|econnrefused|timeout/i.test(msg)
            if (!isNet) setError(msg || "Failed to load multisigs")
        } finally {
            setLoading(false)
        }
    }, [token, auth.isAuthenticated])

    useEffect(() => { fetchData() }, [fetchData])
    useEffect(() => { document.title = "Multisig Wallets — Memba" }, [])

    // Redirect if not authenticated
    useEffect(() => {
        if (!auth.isAuthenticated && !loading) navigate("/", { replace: true })
    }, [auth.isAuthenticated, loading, navigate])

    const handleJoin = async (ms: Multisig) => {
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
            fetchData()
        } catch (err) {
            logChainError("multisigHub:join", err, "error", (auth as { address?: string }).address || undefined)
            setError(err instanceof Error ? err.message : "Failed to join")
        } finally {
            setJoiningAddr(null)
        }
    }

    if (!auth.isAuthenticated) return null

    return (
        <div className="msh-page" data-testid="multisig-hub">
            {/* Header */}
            <div className="msh-header">
                <div className="msh-header-left">
                    <LockKey size={22} weight="duotone" />
                    <h1>Multisig Wallets</h1>
                </div>
                <button className="k-btn-primary msh-create-btn" onClick={() => navigate("/create")} data-testid="multisig-create-btn">
                    <Plus size={14} weight="bold" /> Create New
                </button>
            </div>
            <p className="msh-subtitle">Manage your multisig wallets, review pending actions, and discover new wallets.</p>

            {/* Loading */}
            {loading && (
                <div className="msh-loading">
                    <div className="val-spinner" />
                    <span>Loading wallets...</span>
                </div>
            )}

            {/* My Wallets */}
            {!loading && (
                <section className="msh-section">
                    <div className="msh-section-header">
                        <Wallet size={16} />
                        <h2>My Wallets</h2>
                        <span className="k-label">{joined.length} active</span>
                    </div>

                    {joined.length === 0 ? (
                        <div className="msh-empty">
                            <LockKey size={32} weight="thin" className="msh-empty-icon" />
                            <p>No multisig wallets yet</p>
                            <span>Create your first multisig wallet to get started with shared treasury management.</span>
                            <button className="k-btn-primary" onClick={() => navigate("/create")}>
                                Create Multisig →
                            </button>
                        </div>
                    ) : (
                        <div className="msh-grid">
                            {joined.map(ms => (
                                <div
                                    key={ms.address}
                                    className="msh-card"
                                    onClick={() => navigate(`/multisig/${ms.address}`)}
                                    data-testid={`multisig-card-${ms.address}`}
                                >
                                    <div className="msh-card-top">
                                        <span className="msh-card-name">{ms.name || "Unnamed"}</span>
                                        <span className="msh-threshold">{ms.threshold}/{ms.membersCount}</span>
                                    </div>
                                    <div className="msh-card-addr">
                                        <CopyableAddress address={ms.address} />
                                    </div>
                                    <div className="msh-card-meta">
                                        <span className="msh-card-meta-item">
                                            <Users size={12} /> {ms.membersCount} member{ms.membersCount !== 1 ? "s" : ""}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}

            {/* Discoverable */}
            {!loading && discoverable.length > 0 && (
                <section className="msh-section">
                    <div className="msh-section-header">
                        <MagnifyingGlass size={16} />
                        <h2>Discovered Wallets</h2>
                        <span className="k-label">{discoverable.length} found</span>
                    </div>
                    <p className="msh-discover-hint">
                        These multisigs include your address as a member. Join to start managing them.
                    </p>

                    <div className="msh-grid">
                        {discoverable.map(ms => (
                            <div key={ms.address} className="msh-card msh-card-discover" data-testid={`multisig-discover-${ms.address}`}>
                                <div className="msh-card-top">
                                    <span className="msh-card-name">{ms.name || "Unnamed"}</span>
                                    <span className="msh-threshold msh-threshold-warn">{ms.threshold}/{ms.membersCount}</span>
                                </div>
                                <div className="msh-card-addr">
                                    <CopyableAddress address={ms.address} />
                                </div>
                                <button
                                    className="k-btn-primary msh-join-btn"
                                    disabled={joiningAddr === ms.address}
                                    onClick={(e) => { e.stopPropagation(); handleJoin(ms) }}
                                >
                                    {joiningAddr === ms.address ? "Joining..." : "✓ Join Multisig"}
                                </button>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            <ErrorToast message={error} onDismiss={() => setError(null)} onRetry={() => { setError(null); fetchData() }} />
        </div>
    )
}
