import { test, expect } from '@playwright/test'

/**
 * Mobile touch-target compliance for the home's primary actions.
 *
 * The HIG / Material minimum tap target is 44px. The visitor hero CTAs are the
 * home's most important actions and always render (static copy, no backend), so
 * they're the deterministic guard for the ergonomics pass. (Data-dependent
 * controls — GovDAO rows, ecosystem links, activity Retry — are fixed in the
 * same mobile CSS pass but not asserted here, to keep this test backend-free.)
 */
test('home hero CTAs meet the 44px mobile touch target', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    const ctas = page.locator('.visitor-hero__cta')
    await expect(ctas.first()).toBeVisible()
    const count = await ctas.count()
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < count; i++) {
        const box = await ctas.nth(i).boundingBox()
        expect(box, `cta ${i} has a box`).not.toBeNull()
        expect(box!.height, `cta ${i} height >= 44`).toBeGreaterThanOrEqual(44)
    }
})
