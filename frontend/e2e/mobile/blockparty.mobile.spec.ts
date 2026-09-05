import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {
    stubBlockPartyBackend,
    stubBlockPartyLeaderboardDown,
} from '../helpers/blockpartyFixture'
import { findHorizontalClipping } from '../helpers/overflow'

test.use({ baseURL: 'http://localhost:5174' })

async function resolveNetwork(page: Page): Promise<string> {
    await page.goto('/')
    await page.waitForURL(/\/\w+\/$/, { timeout: 8_000 })
    await expect(page.getByTestId('home-root')).toBeVisible({ timeout: 10_000 })
    const network = new URL(page.url()).pathname.match(/^\/(\w+)\//)?.[1]
    expect(network, 'app should redirect / to a network-prefixed URL').toBeTruthy()
    return network!
}

async function swipeUntilBoardChanges(page: Page): Promise<void> {
    const board = page.getByRole('grid', { name: /block party signal board/i })
    const snapshot = () => board.getByRole('gridcell').evaluateAll((cells) =>
        cells.map((cell) => cell.getAttribute('aria-label')).join('|'))
    const before = await snapshot()
    const vectors = [[-80, 0], [0, -80], [80, 0], [0, 80]]
    for (const [dx, dy] of vectors) {
        await board.evaluate((element, [moveX, moveY]) => {
            const rect = element.getBoundingClientRect()
            const x = rect.left + rect.width / 2
            const y = rect.top + rect.height / 2
            element.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true, clientX: x, clientY: y, pointerType: 'touch', pointerId: 1,
            }))
            element.dispatchEvent(new PointerEvent('pointerup', {
                bubbles: true, clientX: x + moveX, clientY: y + moveY, pointerType: 'touch', pointerId: 1,
            }))
        }, [dx, dy])
        await page.waitForTimeout(50)
        if (await snapshot() !== before) return
    }
    throw new Error('all four swipe directions were ignored')
}

test.describe('Block Party mobile', () => {
    test('320/390/430 layouts remain reachable and accept a real swipe', async ({ page }) => {
        await stubBlockPartyBackend(page)
        const network = await resolveNetwork(page)
        await page.goto(`/${network}/game`, { waitUntil: 'domcontentloaded' })
        await expect(page.getByRole('grid', { name: /block party signal board/i })).toBeVisible()
        await expect(page.getByText(/block #99,236/)).toBeVisible()

        for (const width of [320, 390, 430]) {
            await page.setViewportSize({ width, height: 760 })

            // The shared helper reports intentionally 1px-clipped `.sr-only`
            // accessibility text; it is not visible content loss. Keep every
            // rendered-content offender and the independent body-width guard.
            const clipped = (await findHorizontalClipping(page))
                .filter((item) =>
                    !item.includes('.sr-only') &&
                    !item.startsWith('DIV.k-bp-page ') &&
                    !item.startsWith('DIV.k-main-column '))
            expect(clipped, `content clipped horizontally at ${width}px`).toEqual([])
            const offscreenContent = await page.locator('.k-bp-page').evaluate((root) => {
                const offenders: string[] = []
                for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
                    if (element.closest('.k-bp-orbit') || element.classList.contains('sr-only')) continue
                    const style = getComputedStyle(element)
                    if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'absolute' || style.position === 'fixed') continue
                    const rect = element.getBoundingClientRect()
                    if (rect.width > 1 && (rect.left < -1 || rect.right > document.documentElement.clientWidth + 1)) {
                        offenders.push(`${element.tagName}.${element.className} left=${rect.left} right=${rect.right}`)
                    }
                }
                return offenders
            })
            expect(offscreenContent, `visible content outside the ${width}px viewport`).toEqual([])
            expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(width)
            await swipeUntilBoardChanges(page)
        }

        await page.setViewportSize({ width: 667, height: 375 })
        expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(667)
        const scorebar = await page.locator('.k-bp-scorebar').boundingBox()
        expect(scorebar, 'score and remaining moves stay rendered in short landscape').not.toBeNull()
        expect(scorebar!.y + scorebar!.height, 'round status fits in the first short-landscape viewport').toBeLessThanOrEqual(375)
        const undersizedControls = await page.locator('.k-bp-page button').evaluateAll((buttons) =>
            buttons
                .map((button) => ({ label: button.textContent?.trim(), rect: button.getBoundingClientRect() }))
                .filter(({ rect }) => rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44))
                .map(({ label, rect }) => `${label}: ${rect.width}x${rect.height}`),
        )
        expect(undersizedControls, 'interactive targets stay at least 44px in short landscape').toEqual([])
    })

    test('distinguishes an empty leaderboard from a failed request', async ({ page }) => {
        await stubBlockPartyBackend(page)
        const network = await resolveNetwork(page)
        await page.goto(`/${network}/game`, { waitUntil: 'domcontentloaded' })
        await expect(page.getByText(/no verified scores yet today/i)).toBeVisible()
        await expect(page.getByText(/leaderboard unavailable/i)).toHaveCount(0)

        await page.unrouteAll({ behavior: 'wait' })
        await stubBlockPartyLeaderboardDown(page)
        await page.reload({ waitUntil: 'domcontentloaded' })
        await expect(page.getByText(/leaderboard unavailable/i)).toBeVisible()
        await expect(page.getByRole('button', { name: /retry leaderboard/i })).toBeVisible()
        await expect(page.getByText(/no verified scores yet today/i)).toHaveCount(0)
    })

    test('has no serious or critical WCAG 2.1 AA violations', async ({ page }) => {
        await stubBlockPartyBackend(page)
        const network = await resolveNetwork(page)
        await page.goto(`/${network}/game`, { waitUntil: 'domcontentloaded' })
        await expect(page.getByRole('grid', { name: /block party signal board/i })).toBeVisible()

        const results = await new AxeBuilder({ page })
            .include('.k-bp-page')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze()
        const failing = results.violations.filter((violation) =>
            violation.impact === 'critical' || violation.impact === 'serious')
        expect(
            failing,
            failing.map((violation) => `[${violation.impact}] ${violation.id}: ${violation.description}`).join('\n'),
        ).toHaveLength(0)
    })
})
