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
import { Cube, Coins, ShieldCheck, LinkSimple, ArrowUpRight } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { parseUnfurls } from "../../lib/feedUnfurl"
import { getTokenInfo, formatSupply } from "../../lib/grc20"
import { queryRender } from "../../lib/dao/shared"
import { parseValoperDetail, VALOPERS_REALM } from "../../lib/valopers"
import { GNO_RPC_URL } from "../../lib/config"

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

/**
 * A LIVE token card — resolves the pasted Memba token link to on-chain data
 * (supply + holder count) via the same GRC20 factory Render the token page uses.
 * Shows a skeleton while loading and degrades to a plain `$SYMBOL` card (never a
 * crash, never fabricated numbers) if the read fails or the token is unknown.
 */
function TokenUnfurlCard({ symbol, href }: { symbol: string; href: string }) {
    const { data, isLoading } = useQuery({
        queryKey: ["feed-unfurl-token", symbol],
        queryFn: () => getTokenInfo(GNO_RPC_URL, symbol),
        staleTime: 60_000,
        retry: false,
    })

    const supply = data ? formatSupply(data.totalSupply, data.decimals) : null
    const facts = data
        ? [
            `$${data.symbol}`,
            supply ? `${supply} supply` : null,
            data.knownAccounts != null ? `${data.knownAccounts} holders` : null,
          ].filter(Boolean).join(" · ")
        : `$${symbol}`

    return (
        <a
            className="feed-unfurl feed-unfurl--token"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="feed-unfurl-token"
            aria-busy={isLoading || undefined}
        >
            <span className="feed-unfurl__badge">
                <Coins size={13} weight="fill" /> token
            </span>
            <span className="feed-unfurl__title">{data?.name || `$${symbol}`}</span>
            <span className="feed-unfurl__sub">
                {isLoading ? "Loading…" : facts} <ArrowUpRight size={12} />
            </span>
        </a>
    )
}

/**
 * A LIVE validator card — resolves the pasted `/validators/<operatorAddr>` link
 * to the operator's on-chain valoper profile (moniker + server type) via the
 * valopers registry Render, the same source the validators page uses. Skeleton
 * while loading; degrades to a truncated-address card (never a crash) when the
 * address isn't a registered valoper (e.g. a genesis validator).
 */
function ValidatorUnfurlCard({ address, href }: { address: string; href: string }) {
    const { data, isLoading } = useQuery({
        queryKey: ["feed-unfurl-valoper", address],
        queryFn: async () => {
            const raw = await queryRender(GNO_RPC_URL, VALOPERS_REALM, address)
            return raw ? parseValoperDetail(raw) : null
        },
        staleTime: 60_000,
        retry: false,
    })

    const short = `${address.slice(0, 8)}…${address.slice(-4)}`
    const sub = data ? ["validator", data.serverType || null].filter(Boolean).join(" · ") : "validator"

    return (
        <a
            className="feed-unfurl feed-unfurl--validator"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="feed-unfurl-validator"
            aria-busy={isLoading || undefined}
        >
            <span className="feed-unfurl__badge">
                <ShieldCheck size={13} weight="fill" /> validator
            </span>
            <span className="feed-unfurl__title">{data?.moniker || short}</span>
            <span className="feed-unfurl__sub">
                {isLoading ? "Loading…" : sub} <ArrowUpRight size={12} />
            </span>
        </a>
    )
}

export function PostUnfurls({ body }: { body: string }) {
    const refs = parseUnfurls(body)
    if (refs.length === 0) return null

    return (
        <div className="feed-unfurls" data-testid="feed-unfurls">
            {refs.map((r, i) => {
                if (r.kind === "realm") {
                    return (
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
                    )
                }
                if (r.kind === "token") {
                    return <TokenUnfurlCard key={`token-${i}`} symbol={r.symbol} href={r.href} />
                }
                if (r.kind === "validator") {
                    return <ValidatorUnfurlCard key={`validator-${i}`} address={r.address} href={r.href} />
                }
                return (
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
                )
            })}
        </div>
    )
}
