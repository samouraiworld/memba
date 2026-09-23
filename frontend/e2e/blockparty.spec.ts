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

/** The aria-hidden tile layer must always show exactly the accessible grid's values. */
async function tileLayerMatchesGrid(page) {
	return page.evaluate(() => {
		const cells = Array.from(document.querySelectorAll('[role="gridcell"]')).map((cell) =>
			cell.getAttribute('aria-label')?.match(/column \d+, (\d+)/)?.[1] ?? '0')
		const tiles = new Array(16).fill('0')
		for (const tile of Array.from(document.querySelectorAll<HTMLElement>('.k-bp-tile-pos:not([data-kind="consumed"])'))) {
			const index = Number(tile.style.getPropertyValue('--bp-row')) * 4 + Number(tile.style.getPropertyValue('--bp-col'))
			tiles[index] = tile.querySelector('.k-bp-tile-val')?.textContent ?? '?'
		}
		return cells.length === 16 && cells.join(',') === tiles.join(',')
	})
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

	test('sliding tiles keep up with fast keyboard play', async ({ page }) => {
		await stubBlockPartyBackend(page)
		const network = await resolveNetwork(page)
		await page.goto(`/${network}/game`, { waitUntil: 'domcontentloaded' })
		const board = page.getByRole('grid', { name: /block party signal board/i })
		await expect(page.getByText(/block #99,236/)).toBeVisible({ timeout: 10_000 })
		await expect(page.locator('.k-bp-tile-layer')).toHaveAttribute('aria-hidden', 'true')
		expect(await tileLayerMatchesGrid(page)).toBe(true)

		await board.focus()
		const keys = ['ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight']
		// Faster than the slide: every press lands mid-animation.
		for (let i = 0; i < 12; i++) await page.keyboard.press(keys[(i * 3) % 4], { delay: 10 })
		expect(await tileLayerMatchesGrid(page), 'tile layer mirrors the board mid-animation').toBe(true)
		await expect.poll(() => tileLayerMatchesGrid(page)).toBe(true)
		expect(await page.locator('.k-bp-tile-pos').first().evaluate((tile) => getComputedStyle(tile).transitionDuration)).not.toBe('0s')
	})

	test('failed challenge fetch shows the error notice and never the sheet', async ({ page }) => {
		await stubBlockPartyBackendDown(page)
		const network = await resolveNetwork(page)

		await page.goto(`/${network}/game`, { waitUntil: 'domcontentloaded' })

		await expect(page.getByText(/daily seed unavailable/i)).toBeVisible({ timeout: 15_000 })
		await expect(page.getByText(/couldn't verify today's board/i)).toBeVisible()
		await expect(page.getByRole('button', { name: /retry daily/i })).toBeVisible()
		// The stuck-sheet regression: with the fetch failed, no dialog — ever.
		await expect(page.getByRole('dialog')).toHaveCount(0)
	})

	test('validated cache is visibly unranked until reconnect confirms it', async ({ page }) => {
		await stubBlockPartyBackend(page)
		let online = true
		await page.route('**/memba.v1.MultisigService/GetDailyChallenge', (route) => {
			if (online) return route.fallback()
			return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
		})
		const network = await resolveNetwork(page)

		await page.goto(`/${network}/game`, { waitUntil: 'domcontentloaded' })
		await expect(page.getByText(/block #99,236/)).toBeVisible()

		online = false
		await page.reload({ waitUntil: 'domcontentloaded' })
		await expect(page.getByText(/saved board — not ranked/i)).toBeVisible({ timeout: 15_000 })
		await expect(page.getByText(/it cannot be submitted/i)).toBeVisible()
		await expect(page.getByText(/live daily · first verified replay is final/i)).toHaveCount(0)

		online = true
		// React Query may refetch on its own while the retry button is being
		// located. Click when it remains present; either path must restore the
		// live-ranked state from the network response.
		await page.getByRole('button', { name: /check live board/i }).click({ timeout: 1_000 }).catch(() => undefined)
		await expect(page.getByText(/live daily · first verified replay is final/i)).toBeVisible()
		await expect(page.getByText(/saved board — not ranked/i)).toHaveCount(0)
	})

	test('supports keyboard play, theme switching, and reduced motion', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
		await page.addInitScript(() => localStorage.setItem('memba_theme', 'dark'))
		await stubBlockPartyBackend(page)
		const network = await resolveNetwork(page)
		await page.goto(`/${network}/game`, { waitUntil: 'domcontentloaded' })

		const board = page.getByRole('grid', { name: /block party signal board/i })
		await expect(board).toBeVisible()
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
		const before = await board.getByRole('gridcell').evaluateAll((cells) =>
			cells.map((cell) => cell.getAttribute('aria-label')).join('|'))
		await board.focus()
		for (const key of ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) {
			await board.press(key)
			const after = await board.getByRole('gridcell').evaluateAll((cells) =>
				cells.map((cell) => cell.getAttribute('aria-label')).join('|'))
			if (after !== before) break
		}
		await expect.poll(() => board.getByRole('gridcell').evaluateAll((cells) =>
			cells.map((cell) => cell.getAttribute('aria-label')).join('|'))).not.toBe(before)
		expect(await page.locator('.k-bp-tile').first().evaluate((tile) => getComputedStyle(tile).animationName)).toBe('none')
		// Tiles still land on the right cells, just without the slide.
		expect(await page.locator('.k-bp-tile-pos').first().evaluate((tile) => getComputedStyle(tile).transitionDuration)).toBe('0s')
		await expect.poll(() => tileLayerMatchesGrid(page)).toBe(true)

		if (await page.locator('html').getAttribute('data-theme') !== 'light') {
			await page.getByRole('button', { name: 'Switch to Light theme' }).click()
		}
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
	})
})
