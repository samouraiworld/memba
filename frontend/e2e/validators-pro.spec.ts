import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fulfillProValidatorRoster } from './helpers/proValidatorsFixture'
import { findHorizontalClipping } from './helpers/overflow'
import { stubNetwork } from './helpers/stubNetwork'

test.beforeEach(async ({ page }) => {
    await stubNetwork(page)
    await fulfillProValidatorRoster(page)
    await page.addInitScript(() => {
        // Suppress the unrelated release announcement in this deterministic proof.
        localStorage.setItem('memba_whats_new_seen', '7.5.0')
    })
})

for (const width of [769, 1024, 1280, 1440, 1920, 768, 390, 320]) {
    test(`readable black overview fits at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 1000 })
        await page.emulateMedia({ colorScheme: 'dark' })
        await page.goto('/pearl/validators')
        await expect(page.locator('.k-pro-ui')).toBeVisible()
        await expect(page.getByTestId('validators-page')).toBeVisible()
        await expect(page.locator('.val-header h1')).toHaveCSS('font-size', width < 769 ? '26px' : '30px')
        await page.evaluate(() => {
            const label = document.createElement('span')
            label.textContent = 'Test fixture'
            label.style.cssText = 'font-size:12px;color:var(--pro-secondary)'
            document.querySelector('.val-header')!.appendChild(label)
        })
        if (width === 1440) {
            const axe = await new AxeBuilder({ page }).include('#main-content').analyze()
            expect(axe.violations).toEqual([])
        }
        for (const selector of ['.k-pro-ui', '.k-main', '.k-sidebar', '.k-topbar']) {
            // Main inherits a transparent background; its painted canvas is the shell.
            if (selector === '.k-main') continue
            if (await page.locator(selector).isVisible()) await expect(page.locator(selector)).toHaveCSS('background-color', 'rgb(0, 0, 0)')
        }
        await expect(page.locator('.val-health-badge__label').first()).toHaveCSS('font-size', '12px')
        const clipping = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
        expect(clipping).toBe(false)
        // These two accessible labels intentionally use the existing 1px clip.
        const clipped = (await findHorizontalClipping(page)).filter(row => !/^(CAPTION|SPAN)\.val-sr-only /.test(row))
        expect(clipped).toEqual([])
        if (width >= 769) {
            const fits = await page.locator('.val-table-wrap').evaluate(el => el.scrollWidth <= el.clientWidth + 1)
            // Tablet may contain table scrolling; desktop defaults must fit.
            if (width >= 1280) expect(fits).toBe(true)
            await expect(page.getByRole('columnheader')).toHaveCount(7)
            await expect(page.locator('.val-stat-value').nth(1)).toHaveText('4.0s')
            await expect(page.getByRole('columnheader', { name: 'Profile', exact: true })).toHaveCount(0)
        } else {
            await expect(page.getByTestId('validator-card-1')).toBeVisible()
            await expect(page.locator('.val-search')).toHaveCSS('font-size', '16px')
            await expect(page.getByRole('combobox', { name: 'Sort validators', exact: true })).toHaveCSS('font-size', '16px')
            const first = await page.getByTestId('validator-card-1').boundingBox()
            expect(first!.y).toBeLessThan(700)
            await expect(page.locator('.pro-val-overview')).not.toHaveAttribute('open')
            await page.locator('.pro-val-overview summary').click()
            await expect(page.getByTestId('network-stats')).toBeVisible()
            await page.locator('.pro-val-overview summary').click()
        }
        await page.screenshot({ path: testInfo.outputPath(`fixture-black-${width}.png`), fullPage: true })
    })
}

test('optional fields, sort, search, tabs and light theme remain usable', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/pearl/validators')
    await expect(page.getByTestId('validator-row-1')).toBeVisible()
    if (await page.locator('html').getAttribute('data-theme') !== 'light') {
        await page.getByRole('button', { name: 'Switch to Light theme' }).click()
    }
    await expect(page.locator('.k-pro-ui')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await page.getByRole('checkbox', { name: 'All columns' }).check()
    await expect(page.getByRole('columnheader', { name: 'Profile', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Participation', exact: true }).click()
    await expect(page.getByRole('columnheader', { name: 'Participation' })).toHaveAttribute('aria-sort', 'descending')
    await page.getByRole('checkbox', { name: 'All columns' }).uncheck()
    await expect(page.getByRole('columnheader', { name: 'Rank' })).toHaveAttribute('aria-sort', 'ascending')
    await page.getByRole('textbox', { name: 'Search validators' }).fill('no-matching-validator')
    await expect(page.getByRole('heading', { name: 'No matching validators' })).toBeVisible()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(page.locator('.val-table tbody tr')).toHaveCount(3)
    await page.evaluate(() => { const label = document.createElement('span'); label.textContent = 'Test fixture'; label.style.cssText = 'font-size:12px;color:var(--pro-secondary)'; document.querySelector('.val-header')!.appendChild(label) })
    await page.screenshot({ path: testInfo.outputPath('fixture-light-1440.png'), fullPage: true })
    // Audit the changed pilot content without disabling rules for its table.
    const axe = await new AxeBuilder({ page }).include('#main-content').analyze()
    expect(axe.violations).toEqual([])
    await page.getByRole('tab', { name: /Candidates/ }).click()
    await expect(page).toHaveURL(/tab=candidates/)
    await page.getByRole('tab', { name: /Network/ }).click()
    await expect(page).toHaveURL(/tab=network/)
    await page.getByRole('link', { name: 'Home', exact: true }).click()
    await expect(page.locator('.k-pro-ui')).toHaveCount(0)
})

for (const theme of ['dark', 'light'] as const) {
    test(`mixed health states and keyboard filters in ${theme}`, async ({ page }, testInfo) => {
        await fulfillProValidatorRoster(page, 'mixed')
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.emulateMedia({ colorScheme: theme })
        await page.goto('/pearl/validators')
        await expect(page.locator('.val-table tbody tr')).toHaveCount(4)
        for (const label of ['Healthy', 'Degraded', 'Down', 'Unknown']) {
            await expect(page.locator('.val-table .val-health-badge__label').getByText(label, { exact: true })).toBeVisible()
        }
        await expect(page.locator('.pro-val-health-reason').filter({ hasText: 'Intermittent signing' })).toBeVisible()
        const axe = await new AxeBuilder({ page }).include('#main-content').analyze()
        expect(axe.violations).toEqual([])
        await page.evaluate(() => { const label = document.createElement('span'); label.textContent = 'Test fixture'; label.style.cssText = 'font-size:12px;color:var(--pro-secondary)'; document.querySelector('.val-header')!.appendChild(label) })
        await page.screenshot({ path: testInfo.outputPath(`fixture-mixed-${theme}.png`), fullPage: true })
        const search = page.getByRole('textbox', { name: 'Search validators' })
        await search.focus()
        await page.keyboard.press('Tab')
        const health = page.getByRole('combobox', { name: 'Filter by health' })
        await expect(health).toBeFocused()
        await health.selectOption('unknown')
        await expect(page.locator('.val-table tbody tr')).toHaveCount(1)
        await expect(page.locator('.val-table .val-health-badge__label')).toHaveText('Unknown')
        await search.fill('Northstar')
        await expect(page.getByRole('heading', { name: 'No matching validators' })).toBeVisible()
        await page.getByRole('button', { name: 'Clear filters' }).click()
        await expect(health).toHaveValue('all')
        await health.focus()
        await page.keyboard.press('Tab')
        await expect(page.getByRole('checkbox', { name: 'All columns' })).toBeFocused()
        await page.keyboard.press('Space')
        await expect(page.getByRole('columnheader', { name: 'Profile', exact: true })).toBeVisible()
        const table = page.getByRole('region', { name: 'Validator comparison' })
        await table.focus()
        await page.keyboard.press('ArrowRight')
        await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
        // Focused overflow region supports keyboard comparison with identity pinned.
        await expect(page.locator('.val-identity')).toHaveCSS('position', 'sticky')
        const identity = await page.locator('.val-identity').boundingBox()
        const region = await table.boundingBox()
        expect(identity!.x).toBeGreaterThanOrEqual(region!.x - 1)
        await page.getByRole('tab', { name: /^Validators/ }).focus()
        await page.keyboard.press('ArrowRight')
        await expect(page.getByRole('tab', { name: /Candidates/ })).toBeFocused()
        await expect(page).toHaveURL(/tab=candidates/)
    })
}

test('missing metrics stay unknown and empty roster stays distinct', async ({ page }) => {
    await fulfillProValidatorRoster(page, 'missing')
    await page.goto('/pearl/validators')
    await expect(page.locator('.val-table tbody tr')).toHaveCount(3)
    await expect(page.locator('.val-table .val-health-badge__label')).toHaveText(['Unknown', 'Unknown', 'Unknown'])
    await expect(page.getByText(/Monitoring metrics are unavailable/)).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Uptime', exact: true })).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Filter by health' }).selectOption('healthy')
    await expect(page.getByRole('heading', { name: 'No matching validators' })).toBeVisible()
    await fulfillProValidatorRoster(page, 'empty')
    await page.reload()
    await expect(page.getByRole('heading', { name: 'No validators returned' })).toBeVisible()
})

test('larger roster pagination and filter reset', async ({ page }) => {
    await fulfillProValidatorRoster(page, 'large')
    await page.goto('/pearl/validators')
    await expect(page.locator('.val-table tbody tr')).toHaveCount(50)
    await page.getByRole('button', { name: 'Next page' }).click()
    await expect(page.locator('.val-table tbody tr')).toHaveCount(23)
    await expect(page.getByText('Showing 51–73 of 73')).toBeVisible()
    await expect(page.locator('.val-page-info')).toHaveCSS('font-size', '13px')
    await page.getByRole('combobox', { name: 'Validators per page' }).selectOption('25')
    await expect(page.getByText('Showing 1–25 of 73')).toBeVisible()
    await page.getByRole('button', { name: 'Next page' }).click()
    await page.getByRole('combobox', { name: 'Filter by health' }).selectOption('healthy')
    await expect(page.getByText('Showing 1–25 of 73')).toBeVisible()
    await page.getByRole('textbox', { name: 'Search validators' }).fill('Validator 073')
    await expect(page.locator('.val-table tbody tr')).toHaveCount(1)
    await expect(page.getByRole('link', { name: 'Validator 073', exact: true })).toBeVisible()
})

test('mobile health filter preserves unknown data and disclosure keyboard access', async ({ page }) => {
    await fulfillProValidatorRoster(page, 'mixed')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/pearl/validators')
    await expect(page.getByTestId('validator-card-1')).toBeVisible()
    const health = page.getByRole('combobox', { name: 'Filter by health' })
    await expect(health).toHaveCSS('font-size', '16px')
    await health.selectOption('unknown')
    await expect(page.locator('.val-card')).toHaveCount(1)
    await expect(page.locator('.val-card .val-health-badge__label')).toHaveText('Unknown')
    await page.locator('.pro-val-overview summary').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.pro-val-overview')).toHaveAttribute('open')
    const axe = await new AxeBuilder({ page }).include('#main-content').analyze()
    expect(axe.violations).toEqual([])
})

test('resolved incident badge remains readable in both themes', async ({ page }) => {
    await fulfillProValidatorRoster(page, 'resolved')
    await page.goto('/pearl/validators')
    await expect(page.locator('.val-incident-badge--resolved')).toHaveText('RESOLVED')
    await expect(page.locator('.val-incident-badge--resolved')).toHaveCSS('font-size', '12px')
    for (const theme of ['dark', 'light']) {
        if (await page.locator('html').getAttribute('data-theme') !== theme) {
            await page.getByRole('button', { name: `Switch to ${theme === 'dark' ? 'Black' : 'Light'} theme` }).click()
        }
        // Wait for the existing link-color transition before measuring settled contrast.
        await expect(page.locator('.val-row-link').first()).toHaveCSS('color', theme === 'dark' ? 'rgb(245, 247, 246)' : 'rgb(23, 34, 30)')
        const axe = await new AxeBuilder({ page }).include('#main-content').analyze()
        expect(axe.violations).toEqual([])
    }
})
