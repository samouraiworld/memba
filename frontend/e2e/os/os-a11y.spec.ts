import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { OS_ON } from '../../playwright.os.config'
import { fulfillGovernance } from '../helpers/proGovernanceFixture'

// Day 7: no serious or critical WCAG 2.1 AA violations (contrast included) on
// the main Memba OS surfaces, in the light and dark themes, desktop and phone.
// Memba's own pages inside windows are covered by e2e/accessibility.spec.ts.

async function violations(page: Page): Promise<string[]> {
    // Scan settled colours, not a panel mid fade-in.
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))))
    const r = await new AxeBuilder({ page }).include('.memba-os').exclude('.os-classic').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

/** Accent-filled controls whose text axe can't measure (aria-hidden step numbers, hover-only
 * pin buttons, states a guest never sees): mount each shape in the live theme and measure its
 * text against its own background. */
const ACCENT_FILLS = [
    '<ol class="os-wiz-steps"><li aria-current="step"><span class="os-wiz-dot">1</span></li></ol>',
    '<div class="os-segm"><button aria-checked="true">Yes</button></div>',
    '<span class="os-badge2 os-badge2-dao">D</span>',
    '<div class="os-pinbox"><button class="os-pn">+</button></div>',
]
async function accentFillContrasts(page: Page): Promise<string[]> {
    return page.evaluate((shapes) => {
        const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
        const lum = (c: string) => {
            const [r, g, b] = rgb(c).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
            return 0.2126 * r + 0.7152 * g + 0.0722 * b
        }
        const host = document.createElement('div')
        document.querySelector('.memba-os')!.appendChild(host)
        const low = shapes.flatMap((html) => {
            host.innerHTML = html
            const el = host.querySelector('.os-wiz-dot, button, .os-badge2') as HTMLElement
            const cs = getComputedStyle(el)
            const [a, b] = [lum(cs.color), lum(cs.backgroundColor)].sort((x, y) => y - x)
            const ratio = (a + 0.05) / (b + 0.05)
            return ratio < 4.5 ? [`${el.className || el.tagName}: ${ratio.toFixed(2)}`] : []
        })
        host.remove()
        return low
    }, ACCENT_FILLS)
}

for (const scheme of ['light', 'dark'] as const) {
    test.describe(`Memba OS accessibility · ${scheme}`, () => {
        test.beforeEach(async ({ page }) => {
            await page.emulateMedia({ colorScheme: scheme })
            await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (r) => r.abort())
            await fulfillGovernance(page)
        })

        test('lock screen, desktop, DAO windows and the start menu', async ({ page }) => {
            await page.setViewportSize({ width: 1280, height: 860 })
            await page.goto(`${OS_ON}/os`)
            await expect(page.getByRole('dialog', { name: 'Welcome to Memba' })).toBeVisible()
            // A first visit plays the boot over the lock screen; scan what stays once it ends.
            await expect(page.getByTestId('os-boot')).toHaveCount(0)
            expect(await violations(page)).toEqual([])
            await page.getByRole('button', { name: 'Continue as guest' }).click()
            await expect(page.getByRole('region', { name: 'Welcome to Memba' })).toBeVisible()
            expect(await violations(page)).toEqual([])
            await page.goto(`${OS_ON}/os/dao/govdao/proposals/4?w=app.daos`)
            await expect(page.getByRole('heading', { name: 'Fund the community education programme' })).toBeVisible()
            expect(await violations(page)).toEqual([])
            await page.goto(`${OS_ON}/os/daos/new`)
            await expect(page.getByRole('region', { name: 'Create a DAO', exact: true }).getByText('Connect a wallet to create a DAO.')).toBeVisible()
            expect(await violations(page)).toEqual([])
            expect(await accentFillContrasts(page)).toEqual([])
            await page.getByRole('button', { name: 'Memba menu' }).click()
            await expect(page.getByRole('menu', { name: 'All apps' })).toBeVisible()
            expect(await violations(page)).toEqual([])
        })

        test('phone home screen and a sheet', async ({ page }) => {
            await page.addInitScript(() => localStorage.setItem('memba_os_seen', '1'))
            await page.setViewportSize({ width: 375, height: 760 })
            await page.goto(`${OS_ON}/os`)
            await expect(page.getByRole('main', { name: 'Home' })).toBeVisible()
            expect(await violations(page)).toEqual([])
            await page.goto(`${OS_ON}/os/dao/govdao`)
            await expect(page.getByRole('region', { name: 'govdao', exact: true }).getByText('GovDAO', { exact: true })).toBeVisible()
            expect(await violations(page)).toEqual([])
        })
    })
}

test.describe('Memba OS keyboard and motion', () => {
    test.beforeEach(async ({ page }) => {
        await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (r) => r.abort())
        await fulfillGovernance(page)
        await page.addInitScript(() => localStorage.setItem('memba_os_seen', '1'))
        await page.setViewportSize({ width: 1280, height: 860 })
    })

    test('keyboard only: a window opened from search takes focus; option-W closes it and focus moves to the next window', async ({ page }) => {
        await page.goto(`${OS_ON}/os/daos`)
        await expect(page.getByRole('region', { name: 'DAOs', exact: true })).toBeVisible()
        const focusedWindow = () => page.evaluate(() => document.activeElement?.closest('section.os-win')?.getAttribute('aria-label') ?? null)
        await expect.poll(focusedWindow).toBe('DAOs')
        await page.keyboard.press('ControlOrMeta+k')
        await page.keyboard.type('settings')
        await page.keyboard.press('Enter')
        await expect(page.getByRole('region', { name: 'Settings', exact: true })).toBeVisible()
        await expect.poll(focusedWindow).toBe('Settings')
        await page.keyboard.press('Alt+KeyW')
        await expect(page.getByRole('region', { name: 'Settings', exact: true })).toHaveCount(0)
        await expect.poll(focusedWindow).toBe('DAOs')
    })

    test('reduced motion: windows and sheets open without animation', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.goto(`${OS_ON}/os/daos`)
        await expect(page.getByRole('region', { name: 'DAOs', exact: true })).toBeVisible()
        expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0)
    })
})
