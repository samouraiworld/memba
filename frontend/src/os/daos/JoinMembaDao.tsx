/** Community applications are public Feed posts, not voting-seat requests. */
import { useQuery } from "@tanstack/react-query"
import { fetchJoinCandidates } from "../../lib/feedJoin"
import { isFeedEnabled } from "../../lib/config"
import { shortAddr } from "../shell/format"
import { specForTarget, type WindowSpec } from "../shell/windows"
import { applyToJoinSpec } from "./joinSpec"

export function JoinMembaDao({ open }: { open: (spec: WindowSpec) => void }) {
    const available = isFeedEnabled()
    const candidates = useQuery({
        queryKey: ["feed", "join-candidates"],
        queryFn: fetchJoinCandidates,
        staleTime: 60_000,
        retry: false,
        enabled: available,
    })
    if (!available) return <p className="os-sub">Community applications use the Feed and will open when the Feed is available here.</p>

    return (
        <section className="os-card os-stack os-tight" aria-label="Join the Memba DAO community">
            <h3 className="os-h os-flush">Join the Memba DAO community</h3>
            <p className="os-sub os-flush">
                A public #join post in the Feed requests community membership. Admission requires a separate member proposal
                and vote if that channel process is available; posting does not grant membership or a voting seat.
                Your post is public and permanent.
            </p>
            <div className="os-row">
                <button type="button" className="os-btn" onClick={() => open(applyToJoinSpec())}>Apply with a Feed post</button>
            </div>
            <div className="os-row os-between">
                <h3 className="os-h os-flush">Recent applications</h3>
                <button type="button" className="os-btn os-quiet" disabled={candidates.isFetching} onClick={() => void candidates.refetch()}>Refresh applications</button>
            </div>
            {candidates.isPending ? <p className="os-sub" role="status">Looking for #join posts…</p>
                : candidates.isError ? <p className="os-note os-err" role="alert">Couldn't read the Feed. <button type="button" className="os-btn os-quiet os-inline" onClick={() => void candidates.refetch()}>Try again</button></p>
                    : candidates.data.posts.length === 0 ? <p className="os-sub">No applications found in the recent posts scanned.</p>
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
                Scanned the latest {candidates.data.scanned} posts.{candidates.data.complete ? "" : " Older applications may not appear here."} New posts may take a moment to index; refresh to check again.
            </p>}
        </section>
    )
}
