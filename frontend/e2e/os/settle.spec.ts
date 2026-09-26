import { expect, test } from '@playwright/test'
import { settle } from './settle'

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
