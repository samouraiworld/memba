/** #join posts are public Feed posts, not voting-seat requests. */
import { useQuery } from "@tanstack/react-query"
import { COMMUNITY_MEMBERSHIP_COPY, useCommunityMembership } from "../../lib/communityMembership"
import { fetchJoinCandidates } from "../../lib/feedJoin"
import { isFeedEnabled } from "../../lib/config"
import { shortAddr } from "../shell/format"
import { specForTarget, type WindowSpec } from "../shell/windows"
import { applyToJoinSpec } from "./joinSpec"

export function JoinMembaDao({ open }: { open: (spec: WindowSpec) => void }) {
    const available = isFeedEnabled()
    const membership = useCommunityMembership(available)
    const candidates = useQuery({
        queryKey: ["feed", "join-candidates"],
        queryFn: fetchJoinCandidates,
        staleTime: 60_000,
        retry: false,
        enabled: available,
    })
    if (!available) return <p className="os-sub">#join posts are Feed posts, and the Feed is not available here.</p>

    return (
        <section className="os-card os-stack os-tight" aria-label="Join the Memba DAO community">
            <h3 className="os-h os-flush">Join the Memba DAO community</h3>
            <p className="os-sub os-flush">{COMMUNITY_MEMBERSHIP_COPY[membership]}</p>
            <div className="os-row">
                <button type="button" className="os-btn" onClick={() => open(applyToJoinSpec())}>Write a #join post</button>
            </div>
            <div className="os-row os-between">
                <h3 className="os-h os-flush">Recent #join posts</h3>
                <button type="button" className="os-btn os-quiet" disabled={candidates.isFetching} onClick={() => void candidates.refetch()}>Refresh #join posts</button>
            </div>
            {candidates.isPending ? <p className="os-sub" role="status">Looking for #join posts…</p>
                : candidates.isError ? <p className="os-note os-err" role="alert">Couldn't read the Feed. <button type="button" className="os-btn os-quiet os-inline" onClick={() => void candidates.refetch()}>Try again</button></p>
                    : candidates.data.posts.length === 0 ? <p className="os-sub">No #join posts in the recent posts scanned.</p>
                        : <ul className="os-list">{candidates.data.posts.map(post => (
                            <li key={post.id.toString()}>
                                <button type="button" className="os-it os-click" onClick={() => open(specForTarget({ kind: "app", app: "feed", section: `post/${post.id}` })!)}>
                                    <span className="os-grow">
                                        <b className="os-mono" title={post.author}>{shortAddr(post.author)}</b>
                                        <span className="os-sub os-block">{post.body.slice(0, 140)}</span>
                                    </span>
                                </button>
                            </li>
                        ))}</ul>}
            {candidates.data && <p className="os-sub os-flush">
                Scanned the latest {candidates.data.scanned} posts.{candidates.data.complete ? "" : " Older #join posts may not appear here."} New posts may take a moment to index; refresh to check again.
            </p>}
        </section>
    )
}
