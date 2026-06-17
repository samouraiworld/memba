/**
 * CreatorProfile — lists the collections a creator has launched in the
 * memba_collections registry. Doubles as "My Collections" when the route
 * address matches the connected wallet.
 *
 * Routes: /nft/creator/:address  (and /nft/creator → the connected wallet)
 *
 * @module pages/CreatorProfile
 */

import { useState, useEffect, useCallback } from "react"
import { useParams, useOutletContext, Link } from "react-router-dom"
import { fetchCollectionsByCreator, isCollectionVerified } from "../lib/launchpadReads"
import type { CollectionListRow } from "../lib/launchpad"
import { Phase } from "../lib/launchpad"
import { VerifiedBadge } from "../components/nft/VerifiedBadge"
import type { LayoutContext } from "../types/layout"

const PHASE_LABELS: Record<number, string> = {
    [Phase.Draft]: "Draft",
    [Phase.Allowlist]: "Allowlist",
    [Phase.Public]: "Public",
    [Phase.Closed]: "Closed",
}

export function CreatorProfile() {
    const { address: routeAddr } = useParams<{ address: string }>()
    const { adena } = useOutletContext<LayoutContext>()
    const creator = routeAddr || adena?.address || ""
    const isMe = creator !== "" && creator === adena?.address

    const [rows, setRows] = useState<CollectionListRow[]>([])
    const [verifiedIds, setVerifiedIds] = useState<Set<string>>(new Set())
    const [verifiedOnly, setVerifiedOnly] = useState(false)
    const [loading, setLoading] = useState(true)

    const load = useCallback(async () => {
        if (!creator) {
            setLoading(false)
            return
        }
        setLoading(true)
        try {
            const list = await fetchCollectionsByCreator(creator)
            setRows(list)
            const flags = await Promise.all(list.map((c) => isCollectionVerified(c.id).catch(() => false)))
            setVerifiedIds(new Set(list.filter((_, i) => flags[i]).map((c) => c.id)))
        } catch {
            setRows([])
            setVerifiedIds(new Set())
        } finally {
            setLoading(false)
        }
    }, [creator])

    useEffect(() => {
        document.title = `${isMe ? "My" : creator} collections — Memba`
        load()
    }, [creator, isMe, load])

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
                                <Link to={`/nft/collection/${encodeURIComponent(c.id)}`}>
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
