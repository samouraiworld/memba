/**
 * ScrollToTop — Scroll viewport to top on every route change.
 *
 * Placed inside <BrowserRouter> in App.tsx.
 * Exception: hash-based navigation (#section) is not scroll-reset.
 *
 * @module components/layout/ScrollToTop
 */

import { useEffect } from "react"
import { useLocation } from "react-router-dom"

export function ScrollToTop() {
    const { pathname, hash } = useLocation()

    useEffect(() => {
        // Don't scroll-reset on hash navigation (e.g. #leaderboard)
        if (hash) return
        window.scrollTo(0, 0)
    }, [pathname, hash])

    return null
}
