import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { settle, settleAnimations } from './settle'

test('settle waits for every visible loader even when the first status is hidden', async ({ page }) => {
    await page.setContent('<main><div role="status" hidden>Hidden</div><div role="status" id="status">Loading</div><div class="os-spin">Loading more</div></main>')
    await page.evaluate(() => {
        setTimeout(() => document.querySelector('#status')!.remove(), 200)
        setTimeout(() => document.querySelector('.os-spin')!.remove(), 400)
    })
    await settle(page.locator('main'))
    await expect(page.locator('[role="status"]:visible, .os-spin:visible')).toHaveCount(0, { timeout: 0 })
    expect(test.info().annotations).toEqual([])
})

test('settle annotates a persistent visible loader so the scan can still run', async ({ page }) => {
    await page.setContent('<main><div role="status">Loading</div></main>')
    await settle(page.locator('main'), 50)
    expect(test.info().annotations).toContainEqual(expect.objectContaining({ type: 'unsettled' }))
    await expect(page.getByRole('status')).toBeVisible()
})

test('colour scans wait for a finite fade and proceed past an infinite spinner', async ({ page }) => {
    test.setTimeout(5_000)
    await page.setContent('<main><div id="spinner" aria-hidden="true">Loading</div><p id="fade">Ready</p></main>')
    await page.evaluate(() => {
        document.querySelector('#spinner')!.animate([{ opacity: 0.5 }, { opacity: 1 }], { duration: 100, iterations: Infinity })
        document.querySelector('#fade')!.animate([{ opacity: 0.5 }, { opacity: 1 }], { duration: 200, fill: 'forwards' })
    })
    await settleAnimations(page)
    expect(test.info().annotations).toEqual([])
    expect(await page.evaluate(() => document.querySelector('#fade')!.getAnimations()[0].playState)).toBe('finished')
    expect(await page.evaluate(() => document.querySelector('#spinner')!.getAnimations()[0].playState)).toBe('running')
    const scan = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(scan.violations).toEqual([])
})
