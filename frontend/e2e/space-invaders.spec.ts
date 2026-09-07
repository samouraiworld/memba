import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Space Invaders E2E happy-path. The game is pure frontend (deterministic
 * engine, local high score, no wallet/backend), so it runs against the
 * pinned-flags dev server on :5174 (VITE_ENABLE_SPACE_INVADERS=true in the
 * committed root .env.e2e), same lane as blockparty.spec.ts.
 */

test.use({ baseURL: 'http://localhost:5174' })

async function resolveNetwork(page) {
	await page.goto('/')
	await page.waitForURL(/\/\w+\/$/, { timeout: 5000 })
	await expect(page.getByTestId('home-root')).toBeVisible({ timeout: 10_000 })
	const network = new URL(page.url()).pathname.match(/^\/(\w+)\//)?.[1]
	expect(network, 'app should redirect / to a network-prefixed URL').toBeTruthy()
	return network!
}

test.describe('Space Invaders', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
	})

	test('renders the Space Invaders cabinet and starts a daily run from the focused surface', async ({ page }) => {
		const network = await resolveNetwork(page)

		await page.goto(`/${network}/game/space-invaders`, { waitUntil: 'domcontentloaded' })

		// Branded shell and play area are up (flag on → the game, not the gate).
		await expect(page.getByRole('heading', { name: 'Space Invaders' })).toBeVisible({ timeout: 10_000 })
		await expect(page.getByLabel(/space invaders play area/i)).toBeVisible()

		// Daily is the primary entry. Selecting it arms the deterministic run and
		// moves focus to the keyboard-owned surface without starting simulation.
		await page.getByRole('button', { name: /daily run/i }).click()
		const surface = page.getByRole('group', { name: /signal defense game surface/i })
		await expect(surface).toBeFocused()
		const readyPrompt = page.getByRole('heading', { name: /relay standing by/i })
		await expect(readyPrompt).toBeVisible()

		// Hold Space long enough for the rAF loop to sample the held key.
		await page.keyboard.press('Space', { delay: 150 })

		// First input starts the run: the armed overlay clears and status updates.
		await expect(readyPrompt).toBeHidden({ timeout: 10_000 })
		await expect(page.getByText(/relay online/i).first()).toBeVisible()

		// Keyboard-only pause/resume keeps control ownership on the game surface,
		// so movement and fire work immediately after resuming.
		await surface.press('p')
		await expect(page.getByRole('heading', { name: /relay paused/i })).toBeVisible()
		await expect(surface).toBeFocused()
		await surface.press('p')
		await expect(page.getByRole('heading', { name: /relay paused/i })).toBeHidden()
		await expect(surface).toBeFocused()
		// Hold each gameplay key long enough for the rAF loop to sample it.
		await page.keyboard.press('ArrowRight', { delay: 100 })
		await page.keyboard.press('Space', { delay: 100 })
		await expect(page.getByText(/relay online/i).first()).toBeVisible()
	})

	test('has no serious or critical WCAG 2.1 AA violations in the ready cabinet', async ({ page }) => {
		const network = await resolveNetwork(page)
		await page.goto(`/${network}/game/space-invaders`, { waitUntil: 'domcontentloaded' })
		await expect(page.getByRole('heading', { name: 'Space Invaders' })).toBeVisible({ timeout: 10_000 })

		const results = await new AxeBuilder({ page })
			.include('.si-root')
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
			.analyze()
		const failing = results.violations.filter(
			(violation) => violation.impact === 'critical' || violation.impact === 'serious',
		)
		expect(failing, failing.map((violation) => `${violation.id}: ${violation.help}`).join('\n')).toHaveLength(0)
	})
})
