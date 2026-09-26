import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { OS_ON } from '../../playwright.os.config'
import { findHorizontalClipping } from '../helpers/overflow'
import { settleAnimations } from './settle'

async function guest(page: Page, width: number, height: number) {
    await page.route(/memba\.v1\.|\.gno\.land|samourai\.live|onbloc\.xyz|gnolove|plausible\.io|sentry\.|clerk[.-]/, route => route.abort())
    await page.addInitScript(() => localStorage.setItem('memba_os_seen', '1'))
    await page.setViewportSize({ width, height })
}

test('the Memba menu opens About as a system window with a shareable address', async ({ page }) => {
    await guest(page, 1280, 800)
    await page.goto(`${OS_ON}/os`)
    await page.getByRole('button', { name: 'Memba menu' }).click()
    await page.getByRole('menuitem', { name: 'About Memba OS' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/os/about')
    const about = page.getByRole('region', { name: 'About Memba OS', exact: true })
    await expect(about.getByRole('note')).toContainText('Public Beta')
    await expect(about.getByText(/Chain gnoland-1/)).toBeVisible()
    await expect(about.getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute('rel', 'noopener noreferrer')
})

test('the phone opens About from All apps without adding an app tile', async ({ page }) => {
    await guest(page, 375, 812)
    await page.goto(`${OS_ON}/os`)
    await page.getByRole('button', { name: /All apps/ }).click()
    const apps = page.getByRole('region', { name: 'All apps', exact: true })
    await apps.getByRole('button', { name: 'About Memba OS' }).click()
    await expect(page.getByRole('region', { name: 'About Memba OS', exact: true })).toBeVisible()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/os/about')
})

for (const view of [
    { name: 'light', theme: 'light', width: 1400, height: 900 },
    { name: 'dark', theme: 'dark', width: 1400, height: 900 },
    { name: '420px', theme: 'light', width: 1400, height: 900, windowWidth: 420 },
    { name: 'phone', theme: 'light', width: 375, height: 760 },
] as const) {
    test(`About accessibility and layout · ${view.name}`, async ({ page }, testInfo) => {
        await guest(page, view.width, view.height)
        await page.emulateMedia({ colorScheme: view.theme, reducedMotion: 'reduce' })
        await page.goto(`${OS_ON}/os/about`)
        const about = page.getByRole('region', { name: 'About Memba OS', exact: true })
        await expect(about.getByRole('note')).toContainText('Public Beta')
        // The dev server does not emit beta-only art; its local fallback must be visible.
        await expect(about.locator('.os-about-mark')).toBeVisible()
        if ('windowWidth' in view) {
            await about.evaluate((el, width) => { (el as HTMLElement).style.width = `${width}px` }, view.windowWidth)
        }
        const body = about.locator('.os-wbody')
        expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        expect(await findHorizontalClipping(page, '.memba-os')).toEqual([])
        if (view.name === 'phone') expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(view.width)
        await settleAnimations(page)
        const results = await new AxeBuilder({ page }).include('.memba-os').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
        expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
        const screenshot = testInfo.outputPath(`about-${view.name}.png`)
        await page.screenshot({ path: screenshot })
        await testInfo.attach(`about-${view.name}`, { path: screenshot, contentType: 'image/png' })
    })
}
