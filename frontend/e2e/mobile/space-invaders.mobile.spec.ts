import { test, expect } from '@playwright/test'

test.use({ baseURL: 'http://localhost:5174' })

async function resolveNetwork(page) {
	await page.goto('/')
	await page.waitForURL(/\/\w+\/$/, { timeout: 5000 })
	await expect(page.getByTestId('home-root')).toBeVisible({ timeout: 10_000 })
	const network = new URL(page.url()).pathname.match(/^\/(\w+)\//)?.[1]
	expect(network, 'app should redirect / to a network-prefixed URL').toBeTruthy()
	return network!
}

test.describe('Space Invaders: Signal Defense mobile cabinet', () => {
	test('fits the viewport and exposes touch-sized primary controls', async ({ page }) => {
		const network = await resolveNetwork(page)
		await page.goto(`/${network}/game/space-invaders`, { waitUntil: 'domcontentloaded' })

		await expect(page.getByRole('heading', { name: 'Space Invaders' })).toBeVisible({ timeout: 10_000 })
		await expect(page.getByLabel(/space invaders play area/i)).toBeVisible()

		const hasHorizontalOverflow = await page.evaluate(
			() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
		)
		expect(hasHorizontalOverflow).toBe(false)

		for (const control of [
			page.getByRole('button', { name: /daily run/i }),
			page.getByRole('button', { name: /^mute$/i }),
		]) {
			const box = await control.boundingBox()
			expect(box, 'control should be visible').not.toBeNull()
			expect(box!.height).toBeGreaterThanOrEqual(44)
		}

		await page.getByRole('button', { name: /daily run/i }).click()
		const surface = page.getByRole('group', { name: /signal defense game surface/i })
		await expect(surface).toBeFocused()
		const ready = page.getByRole('heading', { name: /relay standing by/i })
		await expect(ready).toBeVisible()

		// A real touch in the fire half starts the armed run; this catches mobile
		// pointer ownership regressions that keyboard-only coverage cannot.
		const stage = await surface.boundingBox()
		expect(stage).not.toBeNull()
		const touch = {
			pointerId: 7,
			pointerType: 'touch',
			isPrimary: true,
			clientX: stage!.x + stage!.width * 0.75,
			clientY: stage!.y + stage!.height * 0.72,
		}
		await surface.dispatchEvent('pointerdown', touch)
		await page.waitForTimeout(200)
		await surface.dispatchEvent('pointerup', touch)
		await expect(ready).toBeHidden({ timeout: 10_000 })
	})

	test('keeps lives visible at 320px and makes short-landscape menus reachable', async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 568 })
		const network = await resolveNetwork(page)
		await page.goto(`/${network}/game/space-invaders`, { waitUntil: 'domcontentloaded' })

		await expect(page.locator('.si-stat--lives')).toBeVisible()
		expect(await page.evaluate(() => document.documentElement.scrollWidth > 321)).toBe(false)

		await page.setViewportSize({ width: 667, height: 320 })
		const freePlay = page.getByRole('button', { name: /free play/i })
		await freePlay.scrollIntoViewIfNeeded()
		await expect(freePlay).toBeVisible()
		await freePlay.click()
		await expect(page.getByRole('heading', { name: /relay standing by/i })).toBeVisible()
	})
})
