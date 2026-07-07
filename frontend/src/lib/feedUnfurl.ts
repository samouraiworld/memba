/**
 * feedUnfurl — detect on-chain object references (and plain links) inside a post
 * body, so the feed can render them as live cards. The Memba-native bit: a
 * gno.land realm/package path (`r/ns/name`, `p/ns/name`, or a full gno.land URL)
 * becomes a "realm" unfurl — a card no web2 feed can produce.
 *
 * Pure + deterministic; the rendering (and any live data fetch) lives in
 * components/feed/PostUnfurls. Capped per post as light anti-spam.
 *
 * @module lib/feedUnfurl
 */

import { NETWORKS } from "./config"

export type UnfurlRef =
    | { kind: "realm"; path: string; href: string }
    | { kind: "token"; symbol: string; href: string }
    | { kind: "validator"; address: string; href: string }
    | { kind: "proposal"; realmPath: string; id: string; href: string }
    | { kind: "link"; url: string; host: string }

const MAX_UNFURLS = 3

const realm = (path: string): UnfurlRef => ({ kind: "realm", path, href: "https://gno.land/" + path })

/**
 * A Memba in-app token link — `/<network>/tokens/<SYMBOL>` — resolves to a live
 * token card. The leading segment must be a real network key (so arbitrary
 * `/x/tokens/y` paths on other sites stay plain links) and the symbol matches
 * the GRC20 uppercase-alphanumeric shape. Returns the symbol, or null.
 */
function tokenSymbolFromPath(pathname: string): string | null {
    const seg = pathname.split("/").filter(Boolean)
    if (seg.length === 3 && seg[1] === "tokens" && NETWORKS[seg[0]] && /^[A-Z0-9]+$/.test(seg[2])) {
        return seg[2]
    }
    return null
}

/**
 * A Memba in-app validator link — `/<network>/validators/<g1address>` — resolves
 * to a live validator card. The canonical profile route is keyed by the operator
 * `g1…` address, so `/validators/hacker` and the 4-segment `/validators/valoper/…`
 * subpath never match. Returns the address, or null.
 */
function validatorAddrFromPath(pathname: string): string | null {
    const seg = pathname.split("/").filter(Boolean)
    if (seg.length === 3 && seg[1] === "validators" && NETWORKS[seg[0]] && /^g1[a-z0-9]{6,}$/.test(seg[2])) {
        return seg[2]
    }
    return null
}

/**
 * A Memba in-app DAO proposal link — `/<network>/dao/<realmPath>/proposal/<id>`
 * (the realmPath itself contains slashes, e.g. `gno.land/r/gov/dao`) — resolves
 * to a live proposal card. Only the canonical `…/proposal/<number>` shape matches
 * (a DAO home or `…/treasury/…` path does not). Returns the realm + id, or null.
 */
function proposalFromPath(pathname: string): { realmPath: string; id: string } | null {
    const seg = pathname.split("/").filter(Boolean)
    const n = seg.length
    if (n >= 5 && NETWORKS[seg[0]] && seg[1] === "dao" && seg[n - 2] === "proposal" && /^\d+$/.test(seg[n - 1])) {
        const realmPath = seg.slice(2, n - 2).join("/")
        if (realmPath) return { realmPath, id: seg[n - 1] }
    }
    return null
}

export function parseUnfurls(body: string): UnfurlRef[] {
    const out: UnfurlRef[] = []
    const seen = new Set<string>()
    const push = (r: UnfurlRef) => {
        const key =
            r.kind === "realm" ? "realm:" + r.path
            : r.kind === "token" ? "token:" + r.symbol
            : r.kind === "validator" ? "validator:" + r.address
            : r.kind === "proposal" ? "proposal:" + r.realmPath + "/" + r.id
            : "link:" + r.url
        if (seen.has(key)) return
        seen.add(key)
        if (out.length < MAX_UNFURLS) out.push(r)
    }

    // 1) Full URLs — a gno.land /r|/p URL is a realm; everything else is a link.
    const urlSpans: Array<[number, number]> = []
    const urlRe = /https?:\/\/[^\s)]+/g
    for (let m = urlRe.exec(body); m; m = urlRe.exec(body)) {
        urlSpans.push([m.index, m.index + m[0].length])
        const url = m[0].replace(/[.,;!?]+$/, "")
        try {
            const u = new URL(url)
            const tokenSymbol = tokenSymbolFromPath(u.pathname)
            const validatorAddr = validatorAddrFromPath(u.pathname)
            const proposal = proposalFromPath(u.pathname)
            if (u.hostname === "gno.land" && /^\/(r|p)\//.test(u.pathname)) {
                push(realm(u.pathname.replace(/^\//, "").replace(/\/$/, "")))
            } else if (tokenSymbol) {
                push({ kind: "token", symbol: tokenSymbol, href: url })
            } else if (validatorAddr) {
                push({ kind: "validator", address: validatorAddr, href: url })
            } else if (proposal) {
                push({ kind: "proposal", realmPath: proposal.realmPath, id: proposal.id, href: url })
            } else {
                push({ kind: "link", url, host: u.hostname })
            }
        } catch {
            /* malformed URL — ignore */
        }
    }
    const inUrl = (i: number) => urlSpans.some(([s, e]) => i >= s && i < e)

    // 2) Bare `gno.land/r|p/...` (no scheme).
    const bareGno = /(?:^|[\s(])gno\.land\/((?:r|p)\/[a-zA-Z0-9_]+(?:\/[a-zA-Z0-9_.-]+)+)/g
    for (let m = bareGno.exec(body); m; m = bareGno.exec(body)) {
        if (inUrl(m.index + m[0].indexOf("gno.land"))) continue
        push(realm(m[1].replace(/[.,;!?]+$/, "")))
    }

    // 3) Bare `r/ns/name` or `p/ns/name` at a token boundary (not mid-word, so
    //    "interior/design" never misfires).
    const barePath = /(?:^|[\s(])((?:r|p)\/[a-zA-Z0-9_]+\/[a-zA-Z0-9_]+)/g
    for (let m = barePath.exec(body); m; m = barePath.exec(body)) {
        if (inUrl(m.index + m[0].indexOf(m[1]))) continue
        push(realm(m[1]))
    }

    return out
}
