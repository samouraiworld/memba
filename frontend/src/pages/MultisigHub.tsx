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
import { useEffect, useState } from "react"
import { useOutletContext } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { LockKey, Plus, MagnifyingGlass, Wallet, Users } from "@phosphor-icons/react"
import { api } from "../lib/api"
import { GNO_CHAIN_ID, GNO_BECH32_PREFIX, ENABLE_NATIVE_GNO_MULTISIG } from "../lib/config"
import { revealInvisibleFormatting } from "../lib/dao/v2Text"
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

    const [joiningAddr, setJoiningAddr] = useState<string | null>(null)

    // Server state lives in React Query, keyed by the auth identity so a
    // wallet switch refetches instead of serving the previous wallet's list.
    const enabled = !!token && auth.isAuthenticated
    const msQuery = useQuery({
        queryKey: ["multisig", "hub", token?.userAddress ?? ""],
        enabled,
        queryFn: async () => {
            const res = await api.multisigs({ authToken: token!, chainId: GNO_CHAIN_ID, limit: 50 })
            return res.multisigs
        },
    })
    const multisigs = msQuery.data ?? []
    // The old code set loading=false immediately when unauthenticated — the
    // redirect effect below keys on that, so a disabled query must NOT read as
    // still-loading here (isPending alone would deadlock the redirect).
    const loading = enabled ? msQuery.isPending : false

    const [actionError, setActionError] = useState<string | null>(null)

    const joined = multisigs.filter(m => m.joined)
    const discoverable = multisigs.filter(m => !m.joined)
    useEffect(() => { document.title = "Multisig Wallets — Memba" }, [])

    // Redirect if not authenticated
    useEffect(() => {
        if (!auth.isAuthenticated && !loading) navigate("/", { replace: true })
    }, [auth.isAuthenticated, loading, navigate])

    const handleJoin = async (ms: Multisig) => {
        if (!token) return
        if (!ms.pubkeyJson) { setActionError("This account cannot be added because its public-key configuration is unavailable."); return }
        setJoiningAddr(ms.address)
        try {
            await api.createOrJoinMultisig({
                authToken: token,
                chainId: ms.chainId || GNO_CHAIN_ID,
                multisigPubkeyJson: ms.pubkeyJson,
                expectedMultisigAddress: ms.address,
                name: ms.name || "",
                bech32Prefix: GNO_BECH32_PREFIX,
            })
            void msQuery.refetch()
        } catch (err) {
            logChainError("multisigHub:join", err, "error", (auth as { address?: string }).address || undefined)
            setActionError(err instanceof Error ? err.message : "Failed to join")
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
                <button type="button" className="k-btn-primary msh-create-btn" disabled={!ENABLE_NATIVE_GNO_MULTISIG} onClick={() => navigate("/create")} data-testid="multisig-create-btn">
                    <Plus size={14} weight="bold" /> New multisig
                </button>
            </div>
            <p className="msh-subtitle">{ENABLE_NATIVE_GNO_MULTISIG ? "Manage your multisig accounts and review their transactions." : "View your multisig accounts and transaction history."}</p>
            {!ENABLE_NATIVE_GNO_MULTISIG && <p className="msh-notice" role="status">Native multisig registration is on hold pending release approval. Existing accounts are available as read-only history.</p>}

            {/* Loading */}
            {loading && (
                <div className="msh-loading">
                    <div className="val-spinner" />
                    <span>Loading wallets...</span>
                </div>
            )}

            {msQuery.isError && (
                <div className="msh-load-error" role="alert">
                    <p>Couldn’t load your multisig accounts. Check your connection and try again.</p>
                    <button type="button" className="k-btn-secondary" onClick={() => { void msQuery.refetch() }}>Try again</button>
                </div>
            )}

            {/* My Wallets */}
            {!loading && !msQuery.isError && (
                <section className="msh-section">
                    <div className="msh-section-header">
                        <Wallet size={16} />
                        <h2>My Wallets</h2>
                        <span className="k-label">{joined.length} added</span>
                    </div>

                    {joined.length === 0 ? (
                        <div className="msh-empty">
                            <LockKey size={32} weight="thin" className="msh-empty-icon" />
                            <p>No multisig accounts yet</p>
                            <span>{ENABLE_NATIVE_GNO_MULTISIG ? "Create a multisig or import an existing account." : "Import an existing account to view its history."}</span>
                            <button type="button" className="k-btn-secondary" onClick={() => navigate("/import")}>
                                Import account
                            </button>
                        </div>
                    ) : (
                        <div className="msh-grid">
                            {joined.map(ms => (
                                <div
                                    key={ms.address}
                                    className="msh-card"
                                    data-testid={`multisig-card-${ms.address}`}
                                >
                                    <div className="msh-card-top">
                                        <button type="button" className="msh-card-name" aria-label={`View ${revealInvisibleFormatting(ms.name || "Unnamed")} multisig history`} onClick={() => navigate(`/multisig/${ms.address}`)}>{revealInvisibleFormatting(ms.name || "Unnamed")}</button>
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
            {!loading && !msQuery.isError && multisigs.length === 50 && <p className="msh-notice" role="status">Showing the newest 50 accounts. Older accounts may not appear here.</p>}

            {!loading && !msQuery.isError && discoverable.length > 0 && (
                <section className="msh-section">
                    <div className="msh-section-header">
                        <MagnifyingGlass size={16} />
                        <h2>Accounts shared with you</h2>
                        <span className="k-label">{discoverable.length} found</span>
                    </div>
                    <p className="msh-discover-hint">
                        These accounts include your address as a member. Add one to your account list to view its history.
                    </p>

                    <div className="msh-grid">
                        {discoverable.map(ms => (
                            <div key={ms.address} className="msh-card msh-card-discover" data-testid={`multisig-discover-${ms.address}`}>
                                <div className="msh-card-top">
                                    <button type="button" className="msh-card-name" aria-label={`View ${revealInvisibleFormatting(ms.name || "Unnamed")} multisig history`} onClick={() => navigate(`/multisig/${ms.address}`)}>{revealInvisibleFormatting(ms.name || "Unnamed")}</button>
                                    <span className="msh-threshold msh-threshold-warn">{ms.threshold}/{ms.membersCount}</span>
                                </div>
                                <div className="msh-card-addr">
                                    <CopyableAddress address={ms.address} />
                                </div>
                                <button
                                    className="k-btn-primary msh-join-btn"
                                    disabled={joiningAddr === ms.address || !ms.pubkeyJson}
                                    title={!ms.pubkeyJson ? "Public-key configuration unavailable" : undefined}
                                    onClick={() => { void handleJoin(ms) }}
                                >
                                    {joiningAddr === ms.address ? "Adding..." : "Add account"}
                                </button>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            <ErrorToast message={actionError} onDismiss={() => setActionError(null)} />
        </div>
    )
}
