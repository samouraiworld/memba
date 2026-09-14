import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { stubNetwork } from './helpers/stubNetwork'
import { fulfillProValidatorRoster } from './helpers/proValidatorsFixture'

test.beforeEach(async ({ page }) => {
    await stubNetwork(page)
    await fulfillProValidatorRoster(page)
    await page.addInitScript(() => localStorage.setItem('memba_whats_new_seen', '7.5.0'))
})

for (const theme of ['dark', 'light'] as const) {
    test(`desktop ${theme} navigation, disclosures and brand`, async ({ page }, info) => {
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        await page.goto('/pearl/validators')
        const sidebar = page.getByTestId('sidebar')
        await expect(sidebar).toHaveCSS('width', '240px')
        await expect(sidebar).toHaveCSS('background-color', theme === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)')
        await expect(sidebar.getByRole('link', { name: 'Validators', exact: true })).toHaveAttribute('aria-current', 'page')
        await expect(sidebar.locator('img')).toHaveAttribute('src', '/brand/folded-m/mark.svg')
        await expect(page.locator('.val-row-link').first()).toBeVisible()
        expect(await page.locator('.val-table-wrap').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        await expect(sidebar.getByRole('link', { name: 'Multisig', exact: true })).toHaveCount(0)
        await page.evaluate(() => {
            const note = document.createElement('span'); note.textContent = 'Test fixture'; note.style.cssText = 'font-size:12px;color:var(--pro-secondary)'; document.querySelector('.val-header')!.appendChild(note)
        })
        await page.screenshot({ path: info.outputPath(`shell-${theme}.png`), fullPage: true })
        const community = sidebar.locator('summary', { hasText: 'Community' })
        await community.focus(); await page.keyboard.press('Enter')
        await expect(sidebar.getByRole('link', { name: 'Quests', exact: true })).toBeVisible()
        await expect(new AxeBuilder({ page }).include('.pro-sidebar').analyze().then(a => a.violations)).resolves.toEqual([])
        await sidebar.getByRole('button', { name: 'Collapse sidebar' }).click()
        await expect(sidebar).toHaveCSS('width', '76px')
        await expect(sidebar.getByRole('link', { name: 'Validators', exact: true })).toBeVisible()
        await sidebar.getByRole('button', { name: 'Expand sidebar' }).click()
        await sidebar.getByRole('button', { name: 'Search and quick actions' }).click()
        await expect(page.getByRole('dialog', { name: /command/i })).toBeVisible()
    })
}

for (const width of [320, 390, 768, 769, 1024, 1280, 1920]) {
    test(`responsive navigation fits ${width}px${width < 769 ? ' mobile' : ''}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 })
        await page.goto('/pearl/validators')
        await expect(page.getByTestId('validators-page')).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        if (width >= 1280) {
            await expect(page.locator('.val-row-link').first()).toBeVisible()
            expect(await page.locator('.val-table-wrap').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        }
        if (width < 769) {
            const bar = page.getByTestId('mobile-tabbar')
            await expect(bar.getByRole('link')).toHaveCount(4)
            await expect(bar.getByRole('button', { name: 'More', exact: true })).toBeVisible()
            expect(await bar.locator('a,button').evaluateAll(els => els.every(el => el.getBoundingClientRect().width >= 44 && el.getBoundingClientRect().height >= 44))).toBe(true)
        } else await expect(page.getByTestId('sidebar')).toBeVisible()
    })
}

for (const theme of ['dark', 'light'] as const) {
    test(`mobile ${theme} More menu contains focus and keeps every public destination`, async ({ page }, info) => {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        await page.goto('/pearl/validators')
        const more = page.getByTestId('mobile-tabbar').getByRole('button', { name: 'More', exact: true })
        await more.click()
        const dialog = page.getByRole('dialog', { name: 'More options' })
        await expect(dialog).toBeVisible()
        for (const name of ['Validators', 'Feed', 'Leaderboard', 'Changelogs']) await expect(dialog.getByRole('link', { name: new RegExp(`^${name}(,| |$)`) })).toBeAttached()
        await expect(dialog.getByRole('link', { name: 'Organizations' })).toHaveCount(0)
        await expect(dialog.getByRole('combobox', { name: 'Switch network' })).toHaveCSS('font-size', '16px')
        const close = dialog.getByRole('button', { name: 'Close menu' })
        await close.focus(); await page.keyboard.press('Shift+Tab')
        await expect(dialog.getByRole('combobox', { name: 'Switch network' })).toBeFocused()
        await page.keyboard.press('Tab'); await expect(close).toBeFocused()
        await expect(new AxeBuilder({ page }).include('.k-bottom-sheet').analyze().then(a => a.violations)).resolves.toEqual([])
        await close.scrollIntoViewIfNeeded()
        await page.screenshot({ path: info.outputPath(`shell-mobile-menu-${theme}.png`) })
        await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(more).toBeFocused()
        await more.click(); await dialog.getByRole('link', { name: 'Validators', exact: true }).click()
        await expect(dialog).toBeHidden()
        await more.click(); await dialog.getByRole('button', { name: /Search/ }).click()
        await expect(page.getByRole('dialog', { name: 'Command palette' }).getByRole('textbox')).toBeFocused()
    })
}

test('shell persists on hacker route without extending the validators body scope', async ({ page }) => {
    await page.goto('/pearl/validators/hacker')
    await expect(page.locator('.k-pro-shell')).toBeVisible()
    await expect(page.locator('.k-pro-ui')).toHaveCount(0)
    await expect(page.getByTestId('sidebar').getByRole('link', { name: 'Validators', exact: true })).toHaveAttribute('aria-current', 'page')
})

test('brand masters render at actual sizes with no external fonts in exported SVGs', async ({ page }, info) => {
    await page.setViewportSize({ width: 1280, height: 1000 })
    await page.goto('/brand/folded-m/specimen.html')
    await expect(page.getByRole('heading', { name: 'The Folded M.' })).toBeVisible()
    expect(await page.locator('img').evaluateAll(imgs => imgs.every(img => img.complete && img.naturalWidth > 0))).toBe(true)
    await expect(new AxeBuilder({ page }).analyze().then(a => a.violations)).resolves.toEqual([])
    await page.screenshot({ path: info.outputPath('folded-m-specimen.png'), fullPage: true })
    const source = await page.request.get('/brand/folded-m/lockup-white.svg')
    expect(await source.text()).not.toMatch(/<text|<image|<script|https?:\/\/(?!www.w3.org)/)
})

test('exports raster artwork from the approved vector masters', async ({ page }, info) => {
    for (const [name, source, width, height] of [
        ['share.png', 'share.svg', 1200, 630],
        ['icon-512.png', 'mark.svg', 512, 512],
        ['maskable-512.png', 'maskable.svg', 512, 512],
        ['apple-touch-icon.png', 'maskable.svg', 180, 180],
        ['favicon-32.png', 'favicon.svg', 32, 32],
        ['favicon-16.png', 'favicon.svg', 16, 16],
    ] as const) {
        await page.setViewportSize({ width, height })
        await page.goto(`/brand/folded-m/${source}`)
        await expect(page.locator('svg')).toBeVisible()
        await page.screenshot({ path: info.outputPath(name), omitBackground: true })
    }
})
