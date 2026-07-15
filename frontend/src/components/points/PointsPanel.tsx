/**
 * PointsPanel — the drop-in reputation surface: the connected member's PersonalRank + the paginated
 * PointsLeaderboard, fed by the on-chain points.ts reads. Self-gates on VITE_ENABLE_POINTS, so it is
 * inert (renders nothing) until the realm is deployed + the flag is flipped — a page can mount it
 * unconditionally today and it stays dark. Route placement is the deploy-time step.
 *
 * @module components/points/PointsPanel
 */

import { useState } from "react"
import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { isPointsEnabled } from "../../lib/config"
import { getProfile, getTopNPage } from "../../lib/points"
import { PersonalRank } from "./PersonalRank"
import { PointsLeaderboard } from "./PointsLeaderboard"
import "./points.css"

const PAGE_SIZE = 25

export function PointsPanel({ address }: { address?: string }) {
    // Gate BEFORE any hooks so the whole surface is inert when the feature is off.
    if (!isPointsEnabled()) return null
    return <PointsPanelInner address={address} />
}

function PointsPanelInner({ address }: { address?: string }) {
    const [page, setPage] = useState(0)

    const profile = useQuery({
        queryKey: ["points", "profile", address],
        queryFn: () => getProfile(address ?? ""),
        enabled: !!address,
    })
    // Fetch ONE extra row so `hasMore` is truthful — never a "Next" that leads to an empty page.
    // strict=true so a real RPC/ABCI failure surfaces as board.isError (a distinct "couldn't load"
    // state) instead of masquerading as an empty leaderboard. keepPreviousData keeps the current page
    // mounted while the next loads, so paging doesn't drop keyboard focus or shift layout.
    const board = useQuery({
        queryKey: ["points", "board", page],
        queryFn: () => getTopNPage(page * PAGE_SIZE, PAGE_SIZE + 1, true),
        placeholderData: keepPreviousData,
    })

    const fetched = board.data ?? []
    const rows = fetched.slice(0, PAGE_SIZE)
    const hasMore = fetched.length > PAGE_SIZE
    return (
        <section className="points-panel" data-testid="points-panel" aria-label="Reputation">
            {address && profile.data && <PersonalRank profile={profile.data} />}
            <PointsLeaderboard
                rows={rows}
                loading={board.isLoading}
                error={board.isError}
                page={page}
                hasMore={hasMore}
                onPageChange={setPage}
                onRetry={() => board.refetch()}
                highlightAddr={address}
            />
        </section>
    )
}
