/**
 * Users Tab — Directory tab showing registered Gno users with contribution scores.
 * Extracted from Directory.tsx for maintainability.
 * @module components/directory/tabs/UsersTab
 */

import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from "react"
import { ArrowRight } from "@phosphor-icons/react"
import { GNO_RPC_URL, GNOLOVE_API_URL } from "../../../lib/config"
import {
    fetchUsers,
    batchFetchUserAvatars,
    calculateContributionScores,
    parseDAOMemberAddresses,
    SEED_DAOS,
    type DirectoryUser,
    type ContributionScore,
} from "../../../lib/directory"
import { queryRender } from "../../../lib/dao/shared"
import { resolveAvatarUrl } from "../../../lib/ipfs"
import { SkeletonCard } from "../../ui/LoadingSkeleton"
import type { TabProps } from "./types"

export function UsersTab({ navigate }: TabProps) {
    const [users, setUsers] = useState<DirectoryUser[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const deferredSearch = useDeferredValue(search)
    const [error, setError] = useState<string | null>(null)
    const [page, setPage] = useState(0)
    const [scores, setScores] = useState<Map<string, ContributionScore>>(new Map())
    const [avatarMap, setAvatarMap] = useState<Map<string, string>>(new Map())
    const PAGE_SIZE = 20
    const fetchedRef = useRef(false)

    const load = useCallback(async () => {
        setLoading(true); setError(null)
        try {
            const data = await fetchUsers()
            setUsers(data)

            // Fetch DAO member data for contribution scoring (best-effort)
            const memberMap = new Map<string, string[]>()
            // M3 fix: _settled naming convention for unused await result
            const _settled = await Promise.allSettled(
                SEED_DAOS.map(async dao => {
                    const raw = await queryRender(GNO_RPC_URL, dao.path, "")
                    if (raw) memberMap.set(dao.path, parseDAOMemberAddresses(raw))
                }),
            )
            void _settled // TypeScript requires reference
            if (memberMap.size > 0) {
                setScores(calculateContributionScores(data, memberMap))
            }

            // Fetch avatars for visible users (best-effort, capped at 10)
            const visibleAddrs = data.slice(0, PAGE_SIZE).map(u => u.address)
            const avatars = await batchFetchUserAvatars(visibleAddrs, GNOLOVE_API_URL)
            if (avatars.size > 0) setAvatarMap(avatars)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load users")
        } finally { setLoading(false) }
    }, [])

    useEffect(() => {
        if (!fetchedRef.current) { fetchedRef.current = true; load() }
    }, [load])

    const filtered = useMemo(() =>
        deferredSearch
            ? users.filter(u =>
                u.name.toLowerCase().includes(deferredSearch.toLowerCase()) ||
                u.address.includes(deferredSearch.toLowerCase()),
            )
            : users,
        [users, deferredSearch])

    const pageItems = useMemo(() => filtered.slice(0, (page + 1) * PAGE_SIZE), [filtered, page])
    const hasMore = pageItems.length < filtered.length

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <input
                type="text"
                placeholder="Search by name or address..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0) }}
                className="dir-search"
                data-testid="user-search"
            />

            {loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <SkeletonCard /><SkeletonCard /><SkeletonCard />
                </div>
            ) : error ? (
                <div className="dir-error">
                    <p>{error}</p>
                    <button className="k-btn-secondary" onClick={load} style={{ fontSize: 11, marginTop: 8 }}>Retry</button>
                </div>
            ) : filtered.length === 0 ? (
                <div className="dir-empty">
                    <p>{search ? `No users matching "${search}"` : "No registered users found"}</p>
                </div>
            ) : (
                <>
                    <div className="dir-count">
                        {filtered.length} user{filtered.length !== 1 ? "s" : ""} found
                    </div>
                    <div className="dir-user-list">
                        {pageItems.map(u => {
                            const score = scores.get(u.address)
                            return (
                                <button
                                    key={u.address}
                                    className="dir-card"
                                    onClick={() => navigate(`/profile/${u.address}`)}
                                    data-testid="user-card"
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                        <div className="dir-user-avatar">
                                            {avatarMap.get(u.address)
                                                ? <img src={resolveAvatarUrl(avatarMap.get(u.address)!)} alt={u.name} />
                                                : u.name.charAt(0)
                                            }
                                        </div>
                                        <div className="dir-card-main">
                                            <div className="dir-card-name">
                                                @{u.name}
                                                {score && score.daoCount > 0 && (
                                                    <span
                                                        className={`dir-inline-badge dir-activity-badge dir-activity-${score.level}`}
                                                        title={`Member of ${score.daoCount} DAO${score.daoCount !== 1 ? "s" : ""}`}
                                                        data-testid="user-score"
                                                    >
                                                        {score.level === "active" ? "⭐" : score.level === "moderate" ? "🔹" : "🔸"}
                                                        {score.daoCount} DAO{score.daoCount !== 1 ? "s" : ""}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="dir-card-path">
                                                {u.address.length > 20
                                                    ? `${u.address.slice(0, 10)}…${u.address.slice(-6)}`
                                                    : u.address}
                                            </div>
                                        </div>
                                    </div>
                                    <ArrowRight size={14} className="dir-arrow" />
                                </button>
                            )
                        })}
                    </div>
                    {hasMore && (
                        <button
                            className="k-btn-secondary dir-load-more"
                            onClick={() => setPage(p => p + 1)}
                        >
                            Load More ({filtered.length - pageItems.length} remaining)
                        </button>
                    )}
                </>
            )}
        </div>
    )
}
