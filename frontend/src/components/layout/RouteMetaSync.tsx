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

const BREADCRUMB_SCRIPT_ID = "memba-breadcrumbs"

/** W6.3 PR3: per-route BreadcrumbList (Home → Section). JSON-LD script tags
 *  are inert (never executed — CSP script-src doesn't apply), crawlers read
 *  them after JS render. Site-level Organization/WebApplication JSON-LD is
 *  static in index.html. */
function upsertBreadcrumbs(origin: string, networkKey: string, pathname: string, sectionTitle: string): void {
    let node = document.getElementById(BREADCRUMB_SCRIPT_ID) as HTMLScriptElement | null
    if (!node) {
        node = document.createElement("script")
        node.type = "application/ld+json"
        node.id = BREADCRUMB_SCRIPT_ID
        document.head.appendChild(node)
    }
    const home = `${origin}/${networkKey}/`
    const items = [
        { "@type": "ListItem", position: 1, name: "Memba", item: home },
        ...(pathname !== `/${networkKey}` && pathname !== `/${networkKey}/`
            ? [{ "@type": "ListItem", position: 2, name: sectionTitle.replace(/ — Memba$/, ""), item: `${origin}${pathname}` }]
            : []),
    ]
    node.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items,
    })
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
        upsertBreadcrumbs(window.location.origin, networkKey, location.pathname, meta.title)
    }, [location.pathname, networkKey])

    return null
}
