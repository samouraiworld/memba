import { test, expect, type Page } from '@playwright/test'

/**
 * Marketplace LIVE surface — 375px layout guard (workstream 2c).
 *
 * Runs on the iphone/pixel projects (testMatch /\.mobile\.spec\.ts$/) against the
 * DEFAULT dev server (:5173 → local .env, VITE_ENABLE_MARKETPLACE_V2 OFF), i.e. the
 * v1 lanes that ship in prod today — NOT the flag-gated v2 tree (that lives on :5174
 * and is covered by marketplace-v2.spec.ts). We assert the LIVE surface the user
 * actually sees.
 *
 * Pins the phone-width invariants the 2c QA pass fixes:
 *   (a) the page body never scrolls sideways at 375px;
 *   (b) the lane tab strip (.um-tabs) fits — it may scroll INSIDE itself, but its
 *       own layout must not widen the viewport (base .um-tabs had no overflow-x);
 *   (c) the NFT Recent Activity list (when the live lane returns any) never
 *       overflows horizontally.
 *
 * The NFT lane reads live test13 RPC, so only layout invariants are asserted here —
 * never listing content (mirrors the v2 spec's live-lane discipline).
 */

/** Let '/' resolve the /:network segment and settle before deep-linking (the app's
 * own boot redirect otherwise races a raced goto). Mirrors marketplace-v2.spec.ts. */
async function resolveNetwork(page: Page): Promise<string> {
    await page.goto('/')
    await page.waitForURL(/\/\w+\/$/, { timeout: 8000 })
    await expect(page.getByTestId('home-root')).toBeVisible({ timeout: 10_000 })
    const network = new URL(page.url()).pathname.match(/^\/(\w+)\//)?.[1]
    expect(network, 'app should redirect / to a network-prefixed URL').toBeTruthy()
    return network!
}

test.describe('Marketplace LIVE surface — 375px layout', () => {
    test.beforeEach(async ({ page }) => {
        // Pin the exact width the mobile CSS (@media max-width:640px) targets.
        await page.setViewportSize({ width: 375, height: 812 })
    })

    test('NFT lane at 375px: no page h-scroll, tab strip + activity list contained', async ({ page }) => {
        const network = await resolveNetwork(page)
        await page.goto(`/${network}/marketplace/nfts`, { waitUntil: 'domcontentloaded' })

        // Shell is up: the lane tab strip renders from the shell regardless of the
        // lane's own data-load state, so it's the deterministic anchor to measure.
        const tabs = page.locator('.um-tabs')
        await expect(tabs).toBeVisible({ timeout: 10_000 })

        // (a) Page-level invariant (same rule the treasury + v2 specs pin): the BODY
        //     never scrolls sideways on a phone; wide content scrolls in its own box.
        const bodyScroll = await page.evaluate(() => document.body.scrollWidth)
        expect(bodyScroll).toBeLessThanOrEqual(380)

        // (b) The tab strip fits: it may scroll INSIDE itself (mobile overflow-x:auto),
        //     but its own layout width must not exceed its box — otherwise the flex row
        //     of 3+ tabs widens the viewport. This is the assertion that FAILS before
        //     the mobile .um-tabs overflow rule lands (base .um-tabs has no overflow).
        const tabsOverflow = await tabs.evaluate((el) => el.scrollWidth - el.clientWidth)
        expect(tabsOverflow, 'tab strip must not overflow its own box').toBeLessThanOrEqual(1)

        // (c) Recent Activity (only when the live NFT lane returns any) — the row of
        //     avatar+text vs price+time must not clip horizontally at 375px.
        const activity = page.locator('[data-testid="nft-recent-activity"]')
        if (await activity.count()) {
            const actOverflow = await activity
                .first()
                .evaluate((el) => el.scrollWidth - el.clientWidth)
            expect(actOverflow, 'recent-activity list must not overflow').toBeLessThanOrEqual(1)
        }
    })
})
