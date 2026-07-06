import { test, expect } from '@playwright/test'

/**
 * Block Party E2E happy-path (Task 11). Guest can play the daily challenge
 * to completion (budget exhaustion) and see the result sheet with Share button.
 * Runs against the pinned-flags dev server on :5174 (VITE_ENABLE_GAME=true).
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

test.describe('Block Party', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
	})

	test('guest can play the daily to completion and see a result', async ({ page }) => {
		const network = await resolveNetwork(page)

		await page.goto(`/${network}/game`, { waitUntil: 'domcontentloaded' })

		// Wait for the board grid to be visible
		const board = page.getByRole('grid')
		await expect(board).toBeVisible({ timeout: 10_000 })

		// Focus the board for keyboard input
		await board.focus()

		// Exhaust the ranked budget with a deterministic key cycle (~40 moves)
		for (let i = 0; i < 40; i++) {
			await page.keyboard.press(['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][i % 4])
		}

		// Assert the Share button appears on the result sheet
		await expect(page.getByRole('button', { name: /share/i })).toBeVisible({ timeout: 10_000 })
	})
})
