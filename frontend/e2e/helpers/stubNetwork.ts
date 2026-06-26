import type { Page } from '@playwright/test'

/**
 * Abort backend/RPC/indexer/3p calls so renders are deterministic for visual diffs.
 * Routes that don't match any pattern are allowed through (static assets, dev server).
 */
const API = [
    /memba\.v1\./,
    /\.gno\.land/,
    /testnets\.gno\.land/,
    /gnoland\.network/,
    /\.onbloc\.xyz/,
    /gnolove\.world/,
    /monitoring\.gnolove/,
    /api\.github\.com/,
    /lighthouse\.storage/,
    /samourai\.live/,
    /plausible\.io/,
    /clerk/,
    /sentry/,
]

export async function stubNetwork(page: Page) {
    await page.route('**/*', route => {
        const url = route.request().url()
        if (API.some(re => re.test(url))) return route.abort()
        return route.continue()
    })
}
