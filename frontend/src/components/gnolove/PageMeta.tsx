/**
 * PageMeta — declarative document.title (+ optional meta description / og:title) override.
 *
 * Implements a race-safe cleanup [MF-10 / Frontend-Architect F-7]:
 *   - On mount, capture the previous title.
 *   - On unmount, only restore the previous title if the CURRENT document.title
 *     still matches what we set. If a sibling component already changed it
 *     (e.g. rapid Report → Analytics → Report navigation), don't clobber.
 *
 * No react-helmet dependency — direct DOM writes inside useEffect.
 *
 * Plan: docs/planning/GNOLOVE_SHAREABLE_REPORT_URLS_PLAN.md §11 Task 5.1.
 *
 * @module components/gnolove/PageMeta
 */

import { useEffect } from "react"

interface PageMetaProps {
    title: string
    description?: string
    image?: string
    url?: string
    noindex?: boolean
}

function setOrCreateMeta(selector: string, attrName: string, value: string): { node: HTMLMetaElement; prevValue: string | null; created: boolean } {
    let node = document.querySelector<HTMLMetaElement>(selector)
    const created = !node
    let prevValue: string | null = null
    if (!node) {
        node = document.createElement("meta")
        const m = selector.match(/\[(.+?)="(.+?)"\]/)
        if (m) node.setAttribute(m[1], m[2])
        document.head.appendChild(node)
    } else {
        prevValue = node.getAttribute(attrName)
    }
    node.setAttribute(attrName, value)
    return { node, prevValue, created }
}

export function PageMeta({ title, description, image, url, noindex }: PageMetaProps) {
    useEffect(() => {
        const prevTitle = document.title
        document.title = title

        const managed: ReturnType<typeof setOrCreateMeta>[] = []

        managed.push(setOrCreateMeta('meta[property="og:title"]', "content", title))
        managed.push(setOrCreateMeta('meta[name="twitter:title"]', "content", title))

        if (description) {
            managed.push(setOrCreateMeta('meta[name="description"]', "content", description))
            managed.push(setOrCreateMeta('meta[property="og:description"]', "content", description))
        }

        const resolvedUrl = url ?? window.location.href
        managed.push(setOrCreateMeta('meta[property="og:url"]', "content", resolvedUrl))

        if (image) {
            managed.push(setOrCreateMeta('meta[property="og:image"]', "content", image))
            managed.push(setOrCreateMeta('meta[name="twitter:image"]', "content", image))
        }

        let robotsMeta: ReturnType<typeof setOrCreateMeta> | null = null
        if (noindex) {
            robotsMeta = setOrCreateMeta('meta[name="robots"]', "content", "noindex")
            managed.push(robotsMeta)
        }

        return () => {
            if (document.title === title) {
                document.title = prevTitle
            }
            for (const { node, prevValue, created } of managed) {
                const cur = node.getAttribute("content")
                if (cur !== title && cur !== description && cur !== resolvedUrl && cur !== image && cur !== "noindex") continue
                if (created) {
                    node.remove()
                } else if (prevValue !== null) {
                    node.setAttribute("content", prevValue)
                }
            }
        }
    }, [title, description, image, url, noindex])

    return null
}
