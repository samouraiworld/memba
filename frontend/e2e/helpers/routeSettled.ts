import type { Page } from '@playwright/test'

/**
 * Resolve once `#main-content` has settled: the lazy route has replaced its
 * Suspense fallback and no DOM mutation has landed in main for `quietMs`.
 *
 * A non-empty `#main-content` is not a rendered route — the fallback's
 * "Loading..." text satisfies that check — and a fixed sleep after it only
 * holds while the dev server answers the route chunk quickly. On a loaded CI
 * runner the chunk was still in flight after the sleep, so axe ran across
 * fallback → skeleton → content. React reuses the skeleton's header node for
 * the real header, and the channels breadcrumb was measured against the
 * shimmer's `--color-border` fill (4.41:1) although the settled page passes.
 *
 * The quiet window restarts on every mutation, so it never waits less than the
 * old fixed sleep and a route that keeps changing fails here, by name, instead
 * of producing an audit of a half-rendered page.
 */
export async function waitForRouteSettled(page: Page, { quietMs = 450, timeout = 15_000 } = {}): Promise<void> {
    await page.waitForFunction((quiet) => {
        const main = document.querySelector('#main-content')
        if (!main) return false
        const w = window as Window & { __routeSettle?: { main: Element; last: number } }
        if (w.__routeSettle?.main !== main) {
            const state = { main, last: performance.now() }
            new MutationObserver(() => { state.last = performance.now() })
                .observe(main, { subtree: true, childList: true, attributes: true, characterData: true })
            w.__routeSettle = state
        }
        const fallback = [...main.querySelectorAll<HTMLElement>('[role="status"]')]
            .some(el => el.innerText.trim() === 'Loading...')
        return !fallback && performance.now() - w.__routeSettle.last >= quiet
    }, quietMs, { timeout, polling: 100 })
}
