/**
 * useInViewport — lazy-mount helper shared by the home boards.
 *
 * Returns `inView: true` once the observed element scrolls near the viewport,
 * using IntersectionObserver with a small rootMargin so content starts mounting
 * just before it appears. In environments without IntersectionObserver (jsdom /
 * legacy browsers) it falls back to inView=true immediately so content still
 * renders.
 *
 * Lives in its own module so both StateBoard (member) and ShowcaseBoard
 * (visitor) reuse identical lazy-mount behavior without duplicating the
 * IntersectionObserver wiring — and so the board component files don't export a
 * non-component (react-refresh).
 *
 * @module hooks/home/useInViewport
 */

import type { RefCallback } from "react"
import { useEffect, useRef, useState } from "react"

export interface UseInViewportResult {
    ref: RefCallback<HTMLElement>
    inView: boolean
}

export function useInViewport(rootMargin = "120px"): UseInViewportResult {
    const [inView, setInView] = useState(false)
    const observerRef = useRef<IntersectionObserver | null>(null)

    const ref: RefCallback<HTMLElement> = (el) => {
        if (!el) return
        if (typeof IntersectionObserver === "undefined") {
            // jsdom / legacy: mount immediately
            setInView(true)
            return
        }
        observerRef.current?.disconnect()
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setInView(true)
                    observer.disconnect()
                }
            },
            { rootMargin },
        )
        observer.observe(el)
        observerRef.current = observer
    }

    useEffect(() => {
        return () => observerRef.current?.disconnect()
    }, [])

    return { ref, inView }
}
