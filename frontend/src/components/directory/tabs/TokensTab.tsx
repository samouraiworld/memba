/**
 * Tokens Tab — Directory tab showing GRC20 tokens from the factory.
 * Extracted from Directory.tsx for maintainability.
 * @module components/directory/tabs/TokensTab
 */

import { useState, useEffect, useCallback, useMemo, useDeferredValue } from "react"
import { ArrowRight } from "@phosphor-icons/react"
import { fetchTokens, type DirectoryToken } from "../../../lib/directory"
import { SkeletonCard } from "../../ui/LoadingSkeleton"
import type { TabProps } from "./types"

export function TokensTab({ navigate }: TabProps) {
    const [tokens, setTokens] = useState<DirectoryToken[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const deferredSearch = useDeferredValue(search)
    const [error, setError] = useState<string | null>(null)
    const [page, setPage] = useState(0)
    const PAGE_SIZE = 20

    const load = useCallback(async () => {
        setLoading(true); setError(null)
        try {
            const data = await fetchTokens()
            setTokens(data)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load tokens")
        } finally { setLoading(false) }
    }, [])

    useEffect(() => { load() }, [load])

    const filtered = useMemo(() =>
        deferredSearch
            ? tokens.filter(t =>
                t.name.toLowerCase().includes(deferredSearch.toLowerCase()) ||
                t.symbol.toLowerCase().includes(deferredSearch.toLowerCase()),
            )
            : tokens,
        [tokens, deferredSearch])

    // M1 audit fix: memoize pageItems to avoid new array on every render
    const pageItems = useMemo(() => filtered.slice(0, (page + 1) * PAGE_SIZE), [filtered, page])
    const hasMore = pageItems.length < filtered.length

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <input
                type="text"
                placeholder="Search tokens by name or symbol..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0) }}
                className="dir-search"
                data-testid="token-search"
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
                    <p>{search ? `No tokens matching "${search}"` : "No tokens registered"}</p>
                </div>
            ) : (
                <>
                    <div className="dir-count">
                        {filtered.length} token{filtered.length !== 1 ? "s" : ""} found
                    </div>
                    <div className="dir-grid">
                        {pageItems.map(t => (
                            <button
                                key={t.path || t.slug}
                                className="dir-card"
                                onClick={() => navigate(`/tokens/${t.symbol}`)}
                                data-testid="token-card"
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                                    <div className="dir-token-avatar">{t.symbol.charAt(0)}</div>
                                    <div className="dir-card-main">
                                        <div className="dir-card-name">{t.name}</div>
                                        <div className="dir-token-symbol">${t.symbol}</div>
                                    </div>
                                </div>
                                <ArrowRight size={14} className="dir-arrow" />
                            </button>
                        ))}
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
