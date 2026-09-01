import { test, expect } from '@playwright/test'
import { stubBlockPartyBackend, stubBlockPartyBackendDown } from './helpers/blockpartyFixture'

/**
 * Block Party E2E. Runs against the pinned-flags dev server on :5174
 * (VITE_ENABLE_GAME=true) with the ConnectRPC reads stubbed by
 * helpers/blockpartyFixture — see its header for why an absolute VITE_API_URL
 * is load-bearing for interception.
 *
 * HISTORY: the previous happy-path spec passed with NO backend at all
 * (verified 2026-09-01 before the rework) — the game-over sheet fired
 * immediately on the 0-budget placeholder board, so "play to completion" was
 * asserting the flash bug, not gameplay. The poll below plays real moves
 * against a real seeded board and the failure-path test pins the
 * error-notice/no-sheet contract that fix introduced.
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

	test('guest plays the seeded daily to completion and sees a result', async ({ page }) => {
		await stubBlockPartyBackend(page)
		const network = await resolveNetwork(page)

		await page.goto(`/${network}/game`, { waitUntil: 'domcontentloaded' })

		const board = page.getByRole('grid')
		await expect(board).toBeVisible({ timeout: 10_000 })

		// The seed proof renders only for a READY challenge — its presence is
		// the anti-vacuity anchor: the stub was actually consumed.
		await expect(page.getByText(/block #99,236/)).toBeVisible({ timeout: 10_000 })
		// No sheet before a single move — the flash-bug regression net.
		await expect(page.getByRole('dialog')).toHaveCount(0)

		await board.focus()

		// Exhaust the 30-move budget. No-op presses don't consume budget, so a
		// fixed press count is seed-dependent — poll until the sheet appears,
		// bounded well above any legal run length.
		const keys = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft']
		let done = false
		for (let i = 0; i < 240 && !done; i++) {
			await page.keyboard.press(keys[i % 4])
			if (i % 8 === 7) {
				done = (await page.getByRole('dialog').count()) > 0
			}
		}
		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
		await expect(page.getByRole('button', { name: /share/i })).toBeVisible()
	})

	test('failed challenge fetch shows the error notice and never the sheet', async ({ page }) => {
		await stubBlockPartyBackendDown(page)
		const network = await resolveNetwork(page)

		await page.goto(`/${network}/game`, { waitUntil: 'domcontentloaded' })

		await expect(page.getByText(/couldn't load today's challenge/i)).toBeVisible({ timeout: 15_000 })
		await expect(page.getByRole('button', { name: /retry/i })).toBeVisible()
		// The stuck-sheet regression: with the fetch failed, no dialog — ever.
		await expect(page.getByRole('dialog')).toHaveCount(0)
	})
})
