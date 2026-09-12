import { test, expect } from '@playwright/test'
import { findHorizontalClipping, MOBILE_375 } from '../helpers/overflow'

/**
 * Mobile containment for the validators surface.
 *
 * THE DEFECT THIS PINS (measured on prod, 390px, 2026-09-12): `.hk-layout` is a
 * single-column grid on mobile, yet its computed track resolved to 674.57px
 * inside a 324px box — 303 elements overflowed and `.k-main-column`
 * (`overflow-x: hidden`) silently destroyed roughly half of every telemetry
 * card. No scrollbar, no hint: the content was simply gone.
 *
 * The cause is the default grid minimum, not the media query. `1fr` means
 * `minmax(auto, 1fr)`, and `auto` floors the track at the widest child's
 * min-content — on this page a 641px peer table and a 483px hash row. The track
 * therefore grows past its own container instead of constraining it.
 *
 * WHY THE SECOND TEST INJECTS A WIDE CHILD. Asserting "the live page does not
 * clip" is necessary but weak: it holds whenever the data happens to be narrow,
 * and every telemetry fetcher on this page returns null on failure, so a stubbed
 * or degraded run renders short strings and passes while the bug is fully
 * present. The property the fix actually establishes is *containment regardless
 * of content width* — so the test states that directly, and stays falsifiable
 * whatever the chain is doing. Verified against the unfixed CSS: it fails.
 */

const VALIDATOR_ROUTES = ['/validators', '/validators/hacker'] as const

for (const route of VALIDATOR_ROUTES) {
    test(`${route} hides no content at 375px`, async ({ page }) => {
        await page.setViewportSize(MOBILE_375)
        await page.goto(route)
        await page.waitForLoadState('domcontentloaded')
        // The page shell is what clips; wait for it rather than for chain data,
        // which may legitimately be absent.
        await page.locator('main').waitFor({ state: 'attached' })

        const clipped = await findHorizontalClipping(page)
        expect(clipped, `${route} clips content horizontally at 375px`).toEqual([])
    })
}

test('the telemetry grid track stays inside its container, whatever the content', async ({ page }) => {
    await page.setViewportSize(MOBILE_375)
    await page.goto('/validators/hacker')
    await page.waitForLoadState('domcontentloaded')

    const layout = page.locator('.hk-layout')
    await layout.waitFor({ state: 'attached' })

    // A peer table and a base64 hash are exactly this shape: an unbreakable
    // child far wider than a phone.
    await layout.evaluate((el) => {
        const probe = document.createElement('div')
        probe.dataset.testid = 'containment-probe'
        probe.style.cssText = 'width:900px;height:4px'
        el.appendChild(probe)
    })

    const { trackWidth, layoutClientWidth } = await layout.evaluate((el) => ({
        trackWidth: Math.round(parseFloat(getComputedStyle(el).gridTemplateColumns) || 0),
        layoutClientWidth: el.clientWidth,
    }))

    // THE invariant `minmax(0, 1fr)` buys: the column is sized by its container,
    // never by its widest child. On the unfixed `1fr` this reports 900.
    //
    // Scope note — this asserts the TRACK only, deliberately. Constraining the
    // track does not make an unshrinkable child fit inside it; it relocates the
    // overflow from the grid to that child, which must then provide its own
    // scroller (as `.hk-peers__table-wrap` does with `overflow-x: auto`). A raw
    // 900px div has no such affordance and would still overflow — correctly. The
    // per-child half of the contract is covered by the route tests above, which
    // measure the real cards.
    expect(trackWidth, 'grid track must be sized by its container, not its widest child')
        .toBeLessThanOrEqual(layoutClientWidth)
})

test('every telemetry card fits the column it is placed in', async ({ page }) => {
    await page.setViewportSize(MOBILE_375)
    await page.goto('/validators/hacker')
    await page.waitForLoadState('domcontentloaded')
    await page.locator('.hk-layout').waitFor({ state: 'attached' })

    const cards = page.locator('.hk-layout > .hk-card')
    // Guard against a vacuous pass: every telemetry fetcher on this page returns
    // null on failure, so a degraded run can render an empty shell that trivially
    // satisfies any containment assertion. Measure only if there is something to
    // measure.
    await expect(cards.first()).toBeAttached()
    const count = await cards.count()
    expect(count, 'expected telemetry cards to render before measuring containment')
        .toBeGreaterThan(0)

    const oversized = await page.evaluate(() => {
        const layout = document.querySelector('.hk-layout')
        if (!layout) return ['.hk-layout missing']
        const track = layout.clientWidth
        return Array.from(layout.children)
            .filter((c) => c.getBoundingClientRect().width > track + 1)
            .map((c) => `${(c.className || '').toString().trim()} w=${Math.round(c.getBoundingClientRect().width)} track=${track}`)
    })
    expect(oversized, 'card(s) wider than their grid column').toEqual([])
})
