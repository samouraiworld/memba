/**
 * RouteMetaSync — W6.3 PR1: applies the per-route SEO meta payload on every
 * navigation (mounted once in Layout).
 *
 * Owns: meta description, og:title, og:description, og:url, twitter:title,
 * and the canonical <link>. Does NOT touch document.title — pages own their
 * titles (see lib/routeMeta.ts module doc for the effect-ordering rationale).
 *
 * Always overwrites on route change (no restore dance needed — every route
 * resolves to a payload, so the head is fully determined by the current URL).
 */
import { useEffect } from "react"
import { useLocation } from "react-router-dom"
import { matchRouteMeta } from "../../lib/routeMeta"
import { useNetworkKey } from "../../hooks/useNetworkNav"

function upsertMeta(selector: string, attrs: Record<string, string>, content: string): void {
    let node = document.head.querySelector<HTMLMetaElement>(selector)
    if (!node) {
        node = document.createElement("meta")
        for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
        document.head.appendChild(node)
    }
    node.setAttribute("content", content)
}

function upsertCanonical(href: string): void {
    let node = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!node) {
        node = document.createElement("link")
        node.setAttribute("rel", "canonical")
        document.head.appendChild(node)
    }
    node.setAttribute("href", href)
}

export function RouteMetaSync() {
    const location = useLocation()
    const networkKey = useNetworkKey()

    useEffect(() => {
        const meta = matchRouteMeta(location.pathname, networkKey)
        const url = `${window.location.origin}${location.pathname}`

        upsertMeta('meta[name="description"]', { name: "description" }, meta.description)
        upsertMeta('meta[property="og:title"]', { property: "og:title" }, meta.title)
        upsertMeta('meta[property="og:description"]', { property: "og:description" }, meta.description)
        upsertMeta('meta[property="og:url"]', { property: "og:url" }, url)
        upsertMeta('meta[name="twitter:title"]', { name: "twitter:title" }, meta.title)
        upsertCanonical(url)
    }, [location.pathname, networkKey])

    return null
}
