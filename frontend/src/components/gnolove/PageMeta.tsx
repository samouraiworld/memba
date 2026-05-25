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

export function PageMeta({ title, description }: PageMetaProps) {
    useEffect(() => {
        const prevTitle = document.title
        document.title = title

        const ogTitle = setOrCreateMeta('meta[property="og:title"]', "content", title)
        const twTitle = setOrCreateMeta('meta[name="twitter:title"]', "content", title)
        let ogDesc: ReturnType<typeof setOrCreateMeta> | null = null
        let metaDesc: ReturnType<typeof setOrCreateMeta> | null = null
        if (description) {
            metaDesc = setOrCreateMeta('meta[name="description"]', "content", description)
            ogDesc = setOrCreateMeta('meta[property="og:description"]', "content", description)
        }

        return () => {
            // Race-safe restore: only roll back if the value we set is still in place.
            if (document.title === title) {
                document.title = prevTitle
            }
            for (const { node, prevValue, created } of [ogTitle, twTitle, ...(ogDesc ? [ogDesc] : []), ...(metaDesc ? [metaDesc] : [])]) {
                if (node.getAttribute("content") !== title && node.getAttribute("content") !== description) continue
                if (created) {
                    node.remove()
                } else if (prevValue !== null) {
                    node.setAttribute("content", prevValue)
                }
            }
        }
    }, [title, description])

    return null
}
