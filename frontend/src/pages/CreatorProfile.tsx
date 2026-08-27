/**
 * CreatorProfile — lists the collections a creator has launched in the
 * memba_collections registry. Doubles as "My Collections" when the route
 * address matches the connected wallet.
 *
 * Routes: /nft/creator/:address  (and /nft/creator → the connected wallet)
 *
 * @module pages/CreatorProfile
 */

import { useState, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { useParams, useOutletContext, Link } from "react-router-dom"
import { useNetworkPath } from "../hooks/useNetworkNav"
import { fetchCollectionsByCreator, isCollectionVerified } from "../lib/launchpadReads"
import type { CollectionListRow } from "../lib/launchpad"
import { Phase } from "../lib/launchpad"
import { VerifiedBadge } from "../components/nft/VerifiedBadge"
import type { LayoutContext } from "../types/layout"
import "./nft-launchpad.css"

const PHASE_LABELS: Record<number, string> = {
    [Phase.Draft]: "Draft",
    [Phase.Allowlist]: "Allowlist",
    [Phase.Public]: "Public",
    [Phase.Closed]: "Closed",
}

export function CreatorProfile() {
    const { address: routeAddr } = useParams<{ address: string }>()
    const { adena } = useOutletContext<LayoutContext>()
    const np = useNetworkPath()
    const creator = routeAddr || adena?.address || ""
    const isMe = creator !== "" && creator === adena?.address

    const [verifiedOnly, setVerifiedOnly] = useState(false)

    // Collections + per-collection verification flags, keyed by creator.
    // Errors degrade to an empty list, as before.
    const collectionsQuery = useQuery({
        queryKey: ["nft", "creator-collections", creator],
        enabled: !!creator,
        queryFn: async () => {
            try {
                const list = await fetchCollectionsByCreator(creator)
                const flags = await Promise.all(list.map((c) => isCollectionVerified(c.id).catch(() => false)))
                return { rows: list, verifiedIds: new Set(list.filter((_, i) => flags[i]).map((c) => c.id)) }
            } catch {
                return { rows: [] as CollectionListRow[], verifiedIds: new Set<string>() }
            }
        },
    })
    const rows = collectionsQuery.data?.rows ?? []
    const verifiedIds = collectionsQuery.data?.verifiedIds ?? new Set<string>()
    const loading = collectionsQuery.isPending

    useEffect(() => {
        document.title = `${isMe ? "My" : creator} collections — Memba`
    }, [creator, isMe])

    if (!creator) return <div className="creator-profile">Connect your wallet to see your collections.</div>

    return (
        <div className="creator-profile">
            <h1>{isMe ? "My Collections" : "Collections"}</h1>
            <p className="form-hint">Creator: <code>{creator}</code></p>
            {isMe && <Link to="/nft/create" className="btn-primary">+ Launch a collection</Link>}

            {verifiedIds.size > 0 && (
                <label className="form-hint">
                    <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} /> Verified only
                </label>
            )}

            {loading ? (
                <p>Loading…</p>
            ) : rows.length === 0 ? (
                <p>No collections yet.</p>
            ) : (
                <ul className="collection-list">
                    {rows
                        .filter((c) => !verifiedOnly || verifiedIds.has(c.id))
                        .map((c) => (
                            <li key={c.id}>
                                <Link to={np(`nft/collection/${c.id}`)}>
                                    <strong>{c.name}</strong>
                                </Link>{" "}
                                <VerifiedBadge verified={verifiedIds.has(c.id)} compact />{" "}
                                <code>{c.slug}</code> — {PHASE_LABELS[c.phase] ?? c.phase}, minted {c.minted}
                            </li>
                        ))}
                </ul>
            )}
        </div>
    )
}

export default CreatorProfile
