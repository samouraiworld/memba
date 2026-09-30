/**
 * Pieces more than one NFT screen shows: the way back, why a read failed,
 * and a paged grid of ledger rows.
 *
 * @module os/apps/nft/parts
 */
import type { InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { ReadError, RealmRefusedError } from "../../../lib/nft/read"
import { CardGrid, Empty, ErrorState, Loading } from "../../kit"

export function Back({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <div className="os-row os-tight-row">
            <button type="button" className="os-btn os-quiet" onClick={onClick}><span aria-hidden="true">←</span> {label}</button>
        </div>
    )
}

/**
 * A read that failed, with a retry only where one can help: a read that
 * reached no answer may succeed again, while a query the realm refused (what
 * it names does not exist) or an answer that breaks its rules fails the same
 * way every time.
 */
export function ReadFailure({ error, what, refused, retry }: { error: Error; what: string; refused?: string; retry: () => void }) {
    if (error instanceof ReadError) return <ErrorState message={`The ${what} could not be read from this network.`} onRetry={retry} />
    if (error instanceof RealmRefusedError) return <ErrorState message={refused ?? `This network's realm refused to read the ${what}.`} />
    return <ErrorState message={`What this network sent for the ${what} does not follow the realm's rules, so it is not shown.`} />
}

/**
 * A ledger list read page by page. A first page that fails is an error, never
 * an empty list; a later page that fails keeps the rows already read above
 * its own error.
 */
export function PagedGrid<T>({ query, what, empty, render }: {
    query: UseInfiniteQueryResult<InfiniteData<T[]>>
    what: string
    empty: string
    render: (row: T) => ReactNode
}) {
    if (query.isPending) return <Loading label={`Reading ${what}…`} />
    if (query.isError && !query.isFetchNextPageError) return <ReadFailure error={query.error} what={what} retry={() => void query.refetch()} />
    const rows = query.data.pages.flat()
    if (rows.length === 0) return <Empty title={empty} />
    return (
        <div className="os-stack os-tight">
            <CardGrid min={150}>{rows.map(render)}</CardGrid>
            {query.isFetchNextPageError
                ? <ErrorState message={`More ${what} could not be read.`} onRetry={query.error instanceof ReadError ? () => void query.fetchNextPage() : undefined} />
                : query.hasNextPage && (
                    <div className="os-row">
                        <button type="button" className="os-btn os-quiet" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                            {query.isFetchingNextPage ? "Reading…" : "Load more"}
                        </button>
                    </div>
                )}
        </div>
    )
}
