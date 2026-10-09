import { expect, test } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'

// Exercise the actual painted title bar even when game engines are gated off.
// Engine lifetime is covered separately by launch.recovery.integration.test.tsx.
for (const [game, section, key] of [
    ['Space Invaders', 'space-invaders', 'game:space-invaders'],
    ['Block Party', 'game', 'game:game'],
] as const) {
    for (const maximized of [true, false]) {
        test(`${game}: pointer return to Arcade (${maximized ? 'maximized' : 'restored'})`, async ({ page }) => {
            await page.setViewportSize({ width: 1440, height: 900 })
            await page.emulateMedia({ reducedMotion: 'reduce' })
            await page.addInitScript(() => {
                localStorage.setItem('memba_os_skip_intro', '1')
                localStorage.setItem('memba_os_booted', '1')
            })
            await page.route('**/*', route => {
                const url = new URL(route.request().url())
                return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
            })
            await page.goto(`${OS_ON}/os/arcade/${section}?w=app.arcade`)
            const window = page.locator(`[data-win="${key}"]`)
            await expect(window).toBeVisible()
            await expect(window).not.toHaveClass(/os-max/)
            if (maximized) {
                await window.getByRole('button', { name: `Maximise ${game} · Arcade`, exact: true }).click()
                await expect(window).toHaveClass(/os-max/)
            }
            const original = await window.elementHandle()
            const back = window.locator('.os-tb').getByRole('button', { name: '← Arcade', exact: true })
            await expect(back).toBeVisible()
            // DOM click dispatch skips CSS hit-testing and would miss this bug.
            await expect.poll(() => back.evaluate(button => {
                const r = button.getBoundingClientRect()
                return button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
            })).toBe(true)
            const box = await back.boundingBox()
            expect(box).not.toBeNull()
            await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
            await expect(page).toHaveURL(/\/os\/arcade$/)
            await expect(window).toHaveClass(/os-parked/)
            await expect(window).toHaveAttribute('inert', '')
            await expect(page.getByRole('region', { name: 'Arcade', exact: true }).getByRole('navigation', { name: 'Arcade' })).toBeVisible()
            expect(await original!.evaluate(node => node.isConnected)).toBe(true)
            await page.getByRole('navigation', { name: 'Dock' }).getByRole('button', { name: `Restore ${game} · Arcade`, exact: true }).click()
            await expect(window).toBeVisible()
            expect(await window.evaluate((node, previous) => node === previous, original)).toBe(true)
        })
    }
}
