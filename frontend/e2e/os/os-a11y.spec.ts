import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { settle, settleAnimations } from './settle'
import { OS_FLAGS_ON, OS_ON } from '../../playwright.os.config'
import { fulfillGovernance } from '../helpers/proGovernanceFixture'
import { abortOnchainReads } from '../helpers/onchain'
import { fulfillProValidatorRoster } from '../helpers/proValidatorsFixture'

// No serious or critical WCAG 2.1 AA violations (contrast included) on the main
// Memba OS surfaces, in the light and dark themes, desktop and phone. The scan
// also covers the classic pages rendered inside windows (.os-classic), which
// used to be excluded here entirely.

async function violations(page: Page): Promise<string[]> {
    // Scan settled colours, not a panel mid fade-in.
    await settleAnimations(page)
    const r = await new AxeBuilder({ page }).include('.memba-os').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

/**
 * Findings inside a classic page that need a markup change (a missing label,
 * a decorative icon exposed as content, …) rather than a colour fix in
 * classic-bridge.css. Each entry is the exact `ruleId: target` string
 * violations() would report; filtered out of classicViolations() only — wave-1
 * follow-up work for that app, tracked in the PR description.
 */
const KNOWN_CLASSIC: string[] = []

async function classicViolations(page: Page): Promise<string[]> {
    return (await violations(page)).filter((v) => !KNOWN_CLASSIC.includes(v))
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
            await expect(page.getByRole('region', { name: 'Create a DAO', exact: true }).getByLabel('Name')).toBeVisible()
            expect(await violations(page)).toEqual([])
            expect(await accentFillContrasts(page)).toEqual([])
            await page.getByRole('button', { name: 'Memba menu' }).click()
            await expect(page.getByRole('menu', { name: 'All apps' })).toBeVisible()
            expect(await violations(page)).toEqual([])
        })

        test('phone home screen and a sheet', async ({ page }) => {
            await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
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

/** Apps with no native OS window: they render their existing Memba page (.os-classic)
 * inside the window instead. The Explorer's home is native (scanned below); its classic
 * directory is still what a tab address shows. The Quests hub is native too (scanned below). */
const CLASSIC_APPS = ['dev-report', 'explorer?tab=packages', 'feedback']

for (const scheme of ['light', 'dark'] as const) {
    test.describe(`Memba OS classic pages accessibility · ${scheme}`, () => {
        test.beforeEach(async ({ page }) => {
            await page.emulateMedia({ colorScheme: scheme })
            await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (r) => r.abort())
            await abortOnchainReads(page)
            await page.addInitScript(() => {
                localStorage.setItem('memba_os_skip_intro', '1')
                localStorage.setItem('memba_os_booted', '1')
            })
            await page.setViewportSize({ width: 1280, height: 860 })
        })

        for (const app of CLASSIC_APPS) {
            test(`${app} window`, async ({ page }) => {
                await page.goto(`${OS_ON}/os/${app}`)
                const classic = page.locator('.os-classic').first()
                await expect(classic).toBeVisible({ timeout: 30_000 })
                await settle(classic)
                expect(await classicViolations(page)).toEqual([])
            })
        }

        test('Explorer native home window', async ({ page }) => {
            await page.goto(`${OS_ON}/os/explorer`)
            const explorer = page.getByRole('region', { name: 'Explorer', exact: true })
            await expect(explorer.getByRole('heading', { level: 1, name: 'Realm directory' })).toBeVisible()
            // Chain reads are refused here: the curated rows show under the unreachable notices.
            await expect(explorer.getByRole('button', { name: 'Open GovDAO, gno.land/r/gov/dao' })).toBeVisible({ timeout: 30_000 })
            await expect(explorer.locator('.os-classic')).toHaveCount(0)
            expect(await violations(page)).toEqual([])
        })

        test('Feed native unavailable window', async ({ page }) => {
            await page.goto(`${OS_ON}/os/feed`)
            const feed = page.getByRole('region', { name: 'Feed', exact: true })
            await expect(feed.getByText('The Feed is disabled in this build.')).toBeVisible()
            expect(await violations(page)).toEqual([])
        })

        test('Store native discovery window', async ({ page }) => {
            await page.goto(`${OS_ON}/os/store`)
            const store = page.getByRole('region', { name: 'App Store', exact: true })
            await expect(store.getByRole('navigation', { name: 'App Store' })).toBeVisible()
            await expect(store.getByRole('button', { name: 'Details for Adena' })).toBeVisible()
            expect(await violations(page)).toEqual([])
        })

        test('Feed native enabled window', async ({ page }) => {
            await page.route(/memba\.v1\.|memba-backend\.fly\.dev/, route => route.fulfill({ status: 503, body: 'offline' }))
            await page.goto(`${OS_FLAGS_ON}/os/feed`)
            const feed = page.getByRole('region', { name: 'Feed', exact: true })
            await expect(feed.getByRole('heading', { name: 'Community posts' })).toBeVisible()
            await expect(feed.getByText('The Feed could not be loaded. Your posts remain on-chain.')).toBeVisible()
            expect(await violations(page)).toEqual([])
        })

        test('tokens native unavailable window', async ({ page }) => {
            await page.goto(`${OS_ON}/os/tokens`)
            const tokens = page.getByRole('region', { name: 'Tokens', exact: true })
            await expect(tokens.getByRole('note')).toContainText('factory is not deployed')
            await expect(tokens.locator('.os-classic')).toHaveCount(0)
            expect(await violations(page)).toEqual([])
        })

        test('Validators native window', async ({ page }) => {
            // Served after the chain-read abort, so it wins. The mixed roster has all four health
            // states (every pill tone, each with its reason) and a validator nobody monitors.
            await fulfillProValidatorRoster(page, 'mixed')
            await page.goto(`${OS_ON}/os/validators`)
            const validators = page.getByRole('region', { name: 'Validators', exact: true })
            await expect(validators.getByRole('button', { name: 'Open validator Northstar' })).toBeVisible()
            for (const health of ['Healthy', 'Degraded', 'Down', 'Unknown']) {
                await expect(validators.getByRole('table').getByText(health, { exact: true })).toBeVisible()
            }
            await expect(validators.locator('.os-classic')).toHaveCount(0)
            expect(await violations(page)).toEqual([])
        })

        test('Validators native window when the chain cannot be read', async ({ page }) => {
            await page.goto(`${OS_ON}/os/validators`)
            const validators = page.getByRole('region', { name: 'Validators', exact: true })
            await expect(validators.getByRole('alert')).toContainText('The validator set could not be read')
            expect(await violations(page)).toEqual([])
        })

        test('Quests native hub', async ({ page }) => {
            await page.goto(`${OS_ON}/os/quests`)
            const quests = page.getByRole('region', { name: 'Quests', exact: true })
            await expect(quests.getByRole('heading', { level: 1, name: 'Quests' })).toBeVisible()
            await expect(quests.getByRole('button', { name: /^First Package/ })).toBeVisible()
            await expect(quests.locator('.os-classic')).toHaveCount(0)
            expect(await violations(page)).toEqual([])
        })

        test('Arcade native lobby', async ({ page }) => {
            await page.goto(`${OS_ON}/os/arcade`)
            const arcade = page.getByRole('region', { name: 'Arcade', exact: true })
            await expect(arcade.getByRole('navigation', { name: 'Arcade' })).toBeVisible()
            expect(await violations(page)).toEqual([])
        })

        test('Settings native appearance and reset sheet', async ({ page }) => {
            await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
            await page.goto(`${OS_ON}/os/settings`)
            const settings = page.getByRole('region', { name: 'Settings', exact: true })
            await expect(settings.getByRole('navigation', { name: 'Settings' })).toBeVisible()
            expect(await violations(page)).toEqual([])
            await settings.getByRole('button', { name: 'Safety' }).click()
            await settings.getByRole('button', { name: 'Reset local app data' }).click()
            await expect(page.getByRole('dialog', { name: 'Reset local app data' })).toBeVisible()
            expect(await violations(page)).toEqual([])
        })
    })
}

test.describe('Memba OS keyboard and motion', () => {
    test.beforeEach(async ({ page }) => {
        await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (r) => r.abort())
        await fulfillGovernance(page)
        await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
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
