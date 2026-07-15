import { test, expect, type Page } from '@playwright/test'
import { stubFeedBackend, FEED_AUTHORS, TOMBSTONE_ID, TOMBSTONE_BODY, BUSY_THREAD_ID } from './helpers/feedFixture'

/**
 * Feed LIVE e2e (Feed v2 plan B.6). Runs against the flag-ON dev server on :5175
 * (npm run dev:e2e-feed → vite --mode e2e-feed → VITE_ENABLE_FEED=true) with the
 * backend ConnectRPCs stubbed by feedFixture (deterministic 25-post world). This
 * is the launch safety net for the Jul-20 traffic wave: it proves the live feed
 * renders past the gate, a moderated (tombstoned) root NEVER leaks its body into
 * any route, and no feed route overflows the 375px mobile viewport.
 *
 * Scoped out (covered elsewhere / awaiting deps): the N-new pill and nav reply
 * badge are timing/wallet-connected-dependent and unit-covered
 * (FeedPage.test.tsx, useFeedReplyBadge.test.tsx); the thread "show more"
 * affordance awaits B.2 (thread reply pagination), so this asserts the large
 * reply set renders, not the pager.
 */

test.use({ baseURL: 'http://localhost:5175' })

const MOBILE = { width: 375, height: 812 }
const DESKTOP = { width: 1280, height: 900 }

async function resolveNetwork(page: Page): Promise<string> {
    await page.goto('/')
    await page.waitForURL(/\/\w+\/$/, { timeout: 10_000 })
    const network = new URL(page.url()).pathname.match(/^\/(\w+)\//)?.[1]
    expect(network, 'app should redirect / to a network-prefixed URL').toBeTruthy()
    return network!
}

/** The core mobile invariant: no feed route may overflow a 375px viewport. */
async function expectNoHorizontalOverflow(page: Page) {
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
    expect(scrollWidth, 'body must not overflow the 375px viewport').toBeLessThanOrEqual(380)
}

test.describe('Feed live (VITE_ENABLE_FEED=true, stubbed backend)', () => {
    test.beforeEach(async ({ page }) => {
        await stubFeedBackend(page)
    })

    test('the live feed renders the fixture timeline (not the gate) and paginates', async ({ page }) => {
        await page.setViewportSize(DESKTOP)
        const network = await resolveNetwork(page)
        await page.goto(`/${network}/feed`, { waitUntil: 'domcontentloaded' })

        // Flag ON → the live feed, never the coming-soon gate.
        await expect(page.getByTestId('feed-page')).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('coming-soon-gate')).toHaveCount(0)
        await expect(page.getByTestId('feed-timeline')).toBeVisible()

        // Page 1 = newest 20 of 25; the newest post is visible, the oldest not yet.
        await expect(page.getByText('Post number 25 on the Memba feed')).toBeVisible()
        await expect(page.getByTestId('feed-post-body')).toHaveCount(20)
        await expect(page.getByText('Post number 1 on the Memba feed')).toHaveCount(0)

        // Copy-link (B.3) is present on posts; the Ecosystem tab (A1.1) is present.
        await expect(page.getByTestId('feed-copy-link-btn').first()).toBeVisible()
        await expect(page.getByTestId('feed-tab-ecosystem')).toBeVisible()

        // Load more → page 2 brings the remaining 5 posts in (scroll/pagination).
        await page.getByTestId('feed-load-more').click()
        await expect(page.getByTestId('feed-post-body')).toHaveCount(25, { timeout: 10_000 })
        await expect(page.getByText('Post number 1 on the Memba feed')).toBeVisible()
    })

    test('a tombstoned thread root shows a tombstone and NEVER leaks its body (P0)', async ({ page }) => {
        await page.setViewportSize(DESKTOP)
        const network = await resolveNetwork(page)
        await page.goto(`/${network}/feed/post/${TOMBSTONE_ID}`, { waitUntil: 'domcontentloaded' })

        await expect(page.getByTestId('feed-thread')).toBeVisible({ timeout: 10_000 })
        // The tombstone article renders (hidden-pending-moderation copy)…
        await expect(page.getByTestId('feed-post-tombstone').first()).toBeVisible()
        // …and the retained on-chain body is NOWHERE in the served DOM.
        await expect(page.getByText(TOMBSTONE_BODY)).toHaveCount(0)
        expect(await page.content()).not.toContain(TOMBSTONE_BODY)
    })

    test('a busy thread renders its large reply set', async ({ page }) => {
        await page.setViewportSize(DESKTOP)
        const network = await resolveNetwork(page)
        await page.goto(`/${network}/feed/post/${BUSY_THREAD_ID}`, { waitUntil: 'domcontentloaded' })

        await expect(page.getByTestId('feed-thread')).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('feed-thread-replies')).toBeVisible()
        await expect(page.getByText('A very active thread', { exact: false })).toBeVisible()
        // The first page of replies (up to 50) is rendered.
        await expect(page.getByText('Reply 1 in the busy thread.')).toBeVisible()
        await expect(page.getByText('Reply 50 in the busy thread.')).toBeVisible()
    })

    test('a user profile timeline renders that author’s posts', async ({ page }) => {
        await page.setViewportSize(DESKTOP)
        const network = await resolveNetwork(page)
        await page.goto(`/${network}/feed/user/${FEED_AUTHORS.A}`, { waitUntil: 'domcontentloaded' })

        await expect(page.getByTestId('feed-profile')).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('feed-profile-list')).toBeVisible()
        // id 25 is authored by A (25 % 3 == 1 → AUTHORS[0]).
        await expect(page.getByText('Post number 25')).toBeVisible()
    })

    test('no feed route overflows a 375px viewport', async ({ page }) => {
        await page.setViewportSize(MOBILE)
        const network = await resolveNetwork(page)

        for (const path of ['feed', `feed/post/${BUSY_THREAD_ID}`, `feed/post/${TOMBSTONE_ID}`, `feed/user/${FEED_AUTHORS.A}`]) {
            await page.goto(`/${network}/${path}`, { waitUntil: 'domcontentloaded' })
            await expect(page.getByTestId(/feed-(page|thread|profile)/).first()).toBeVisible({ timeout: 10_000 })
            await expectNoHorizontalOverflow(page)
        }
    })
})
