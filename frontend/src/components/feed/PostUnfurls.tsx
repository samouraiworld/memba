/**
 * PostUnfurls — renders on-chain object references found in a post body as
 * cards. A gno.land realm/package path becomes a "realm" card (the Memba-native
 * differentiator — an on-chain object embedded in a social post); other URLs
 * become a compact link card. Deterministic from the body; no external fetch
 * (the cards are links). Typed live-data cards (token supply, validator uptime,
 * proposal votes) are a follow-up that slots into the same parse → card path.
 *
 * @module components/feed/PostUnfurls
 */
import { Cube, LinkSimple, ArrowUpRight } from "@phosphor-icons/react"
import { parseUnfurls } from "../../lib/feedUnfurl"

/** Last path segment — the realm/package name. */
function realmName(path: string): string {
    const parts = path.split("/")
    return parts[parts.length - 1] || path
}

/** The `r/namespace` (or `p/namespace`) prefix. */
function realmNamespace(path: string): string {
    const parts = path.split("/")
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : path
}

export function PostUnfurls({ body }: { body: string }) {
    const refs = parseUnfurls(body)
    if (refs.length === 0) return null

    return (
        <div className="feed-unfurls" data-testid="feed-unfurls">
            {refs.map((r, i) =>
                r.kind === "realm" ? (
                    <a
                        key={`realm-${i}`}
                        className="feed-unfurl feed-unfurl--realm"
                        href={r.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="feed-unfurl-realm"
                    >
                        <span className="feed-unfurl__badge">
                            <Cube size={13} weight="fill" /> on-chain
                        </span>
                        <span className="feed-unfurl__title">{realmName(r.path)}</span>
                        <span className="feed-unfurl__sub">
                            {realmNamespace(r.path)} <ArrowUpRight size={12} />
                        </span>
                    </a>
                ) : (
                    <a
                        key={`link-${i}`}
                        className="feed-unfurl feed-unfurl--link"
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="feed-unfurl-link"
                    >
                        <span className="feed-unfurl__badge">
                            <LinkSimple size={13} /> link
                        </span>
                        <span className="feed-unfurl__title">{r.host}</span>
                        <span className="feed-unfurl__sub">
                            Open <ArrowUpRight size={12} />
                        </span>
                    </a>
                ),
            )}
        </div>
    )
}
