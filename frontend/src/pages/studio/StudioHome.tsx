import { useEffect, useState } from "react"
import { Link, useOutletContext } from "react-router-dom"
import type { LayoutContext } from "../../types/layout"
import { useNetworkPath } from "../../hooks/useNetworkNav"
import { fetchCollectionList } from "../../lib/launchpadReads"
import type { CollectionListRow } from "../../lib/launchpad"

const PHASE_LABELS: Record<number, string> = {
    0: "Draft",
    1: "Allowlist",
    2: "Public",
    3: "Closed",
}

function phaseLabel(phase: number): string {
    return PHASE_LABELS[phase] ?? `Phase ${phase}`
}

export function StudioHome() {
    const { adena } = useOutletContext<LayoutContext>()
    const me = adena?.address || ""
    const np = useNetworkPath()

    const [rows, setRows] = useState<CollectionListRow[] | null>(null)

    useEffect(() => {
        if (!me) return
        let cancelled = false
        fetchCollectionList().then((list) => {
            if (!cancelled) setRows(list.filter((r) => r.creator === me))
        })
        return () => { cancelled = true }
    }, [me])

    if (me === "") {
        return (
            <div className="studio-page">
                <p>Connect your wallet to open the Studio.</p>
            </div>
        )
    }

    return (
        <div className="studio-page">
            <header className="studio-home-header">
                <h1>Studio</h1>
                <Link to={np("nft/create")} className="studio-launch-cta">
                    Launch new collection
                </Link>
            </header>

            {rows === null ? (
                <p className="studio-loading">Loading…</p>
            ) : rows.length === 0 ? (
                <p className="studio-empty">
                    You haven't launched any collections yet.
                </p>
            ) : (
                <ul className="studio-collection-list">
                    {rows.map((row) => (
                        <li key={row.id} className="studio-collection-item">
                            <Link to={np(`nft/studio/${row.id}`)}>
                                {row.name}
                            </Link>
                            <span className="studio-phase-label">{phaseLabel(row.phase)}</span>
                            <span className="studio-minted">{row.minted} minted</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
