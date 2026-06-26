import { useSyncExternalStore } from 'react'

/**
 * SSR-safe viewport hook: true when the viewport is at the mobile breakpoint
 * (≤768px), matching the `.k-sidebar`/`mobile-tabbar` CSS switch in index.css.
 *
 * Implemented with `useSyncExternalStore` (the canonical matchMedia pattern):
 * tearing-safe, reactive to breakpoint changes, and SSR-safe — the server
 * snapshot is `false` (desktop), so the desktop shell renders by default and
 * is never disturbed.
 */
const QUERY = '(max-width: 768px)'

function subscribe(onChange: () => void): () => void {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {}
    const mql = window.matchMedia(QUERY)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches
}

function getServerSnapshot(): boolean {
    return false
}

export function useIsMobile(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
