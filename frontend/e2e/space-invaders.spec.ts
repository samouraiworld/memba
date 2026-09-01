import { test, expect } from '@playwright/test'

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

	test('renders the arcade shell and starts the run on first input', async ({ page }) => {
		const network = await resolveNetwork(page)

		await page.goto(`/${network}/game/space-invaders`, { waitUntil: 'domcontentloaded' })

		// HUD and play area are up (flag on → the game, not the coming-soon gate)
		await expect(page.getByText(/score 0/i)).toBeVisible({ timeout: 10_000 })
		await expect(page.getByLabel(/space invaders play area/i)).toBeVisible()

		// The ready prompt shows until the first meaningful input
		const readyPrompt = page.getByText(/space fire/i)
		await expect(readyPrompt).toBeVisible()

		// Hold Space long enough for the rAF loop to sample the held key
		await page.keyboard.press('Space', { delay: 150 })

		// First input starts the run: the ready overlay clears
		await expect(readyPrompt).toBeHidden({ timeout: 10_000 })
	})
})
