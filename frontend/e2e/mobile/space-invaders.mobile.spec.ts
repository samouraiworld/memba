import { test, expect, type Locator, type Page } from '@playwright/test'

test.use({ baseURL: 'http://localhost:5174' })

async function resolveNetwork(page) {
	await page.goto('/')
	await page.waitForURL(/\/\w+\/$/, { timeout: 5000 })
	await expect(page.getByTestId('home-root')).toBeVisible({ timeout: 10_000 })
	const network = new URL(page.url()).pathname.match(/^\/(\w+)\//)?.[1]
	expect(network, 'app should redirect / to a network-prefixed URL').toBeTruthy()
	return network!
}

async function expectContainedWithin(inner: Locator, outer: Locator, label: string) {
	const [innerBox, outerBox] = await Promise.all([inner.boundingBox(), outer.boundingBox()])
	expect(innerBox, `${label} should have a layout box`).not.toBeNull()
	expect(outerBox, `${label} clip container should have a layout box`).not.toBeNull()

	const tolerance = 1
	expect(innerBox!.x, `${label} left edge`).toBeGreaterThanOrEqual(outerBox!.x - tolerance)
	expect(innerBox!.y, `${label} top edge`).toBeGreaterThanOrEqual(outerBox!.y - tolerance)
	expect(innerBox!.x + innerBox!.width, `${label} right edge`).toBeLessThanOrEqual(
		outerBox!.x + outerBox!.width + tolerance,
	)
	expect(innerBox!.y + innerBox!.height, `${label} bottom edge`).toBeLessThanOrEqual(
		outerBox!.y + outerBox!.height + tolerance,
	)
}

/** HUD labels/values whose text is clipped (an ellipsis would be showing). */
async function truncatedHudText(page: Page) {
	return page.locator('.si-hud .si-stat > span, .si-hud .si-stat > strong').evaluateAll(nodes =>
		nodes.filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.textContent),
	)
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
		await expect(ready).toHaveCount(0)
		await expect(page.locator(".si-phase--playing")).toBeVisible()

		// Deliver a complete synthetic touch in one browser task, so no rAF can
		// sample a held pointer between down/up. This deterministically exercises
		// the lost-tap race instead of relying on a 200ms hold and CI scheduling.
		await surface.evaluate(el => {
			const stage = el.getBoundingClientRect()
			const touch = {
				bubbles: true,
				pointerId: 7,
				pointerType: 'touch',
				isPrimary: true,
				clientX: stage.x + stage.width * 0.75,
				clientY: stage.y + stage.height * 0.72,
			}
			el.dispatchEvent(new PointerEvent('pointerdown', touch))
			el.dispatchEvent(new PointerEvent('pointerup', touch))
		})
		await expect(ready).toBeHidden({ timeout: 10_000 })
	})

	test('keeps lives visible at 320px and makes short-landscape menus reachable', async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 568 })
		// A six-digit best must fit the HUD without an ellipsis.
		await page.addInitScript(() => localStorage.setItem('memba.space-invaders.best', '999999'))
		const network = await resolveNetwork(page)
		await page.goto(`/${network}/game/space-invaders`, { waitUntil: 'domcontentloaded' })

		await expect(page.locator('.si-stat--lives')).toBeVisible()
		await expect(page.locator('.si-stat--best strong')).toHaveText('999,999')
		expect(await truncatedHudText(page)).toEqual([])
		expect(await page.evaluate(() => document.documentElement.scrollWidth > 321)).toBe(false)

		await page.setViewportSize({ width: 667, height: 320 })
		const consoleClip = page.locator('.si-console')
		const lives = page.locator('.si-stat--lives')
		const mute = page.getByRole('button', { name: /^mute$/i })
		const pause = page.getByRole('button', { name: /^pause$/i })
		await expect(consoleClip).toBeVisible()
		for (const [control, label] of [
			[lives, 'lives'],
			[mute, 'mute'],
			[pause, 'pause'],
		] as const) {
			await expect(control).toBeVisible()
			await expectContainedWithin(control, consoleClip, label)
		}
		for (const control of [mute, pause]) {
			const box = await control.boundingBox()
			expect(box, 'short-landscape control should be visible').not.toBeNull()
			expect(box!.height).toBeGreaterThanOrEqual(44)
			expect(box!.width).toBeGreaterThanOrEqual(44)
		}
		expect(await page.evaluate(() => document.documentElement.scrollWidth > 668)).toBe(false)

		const stageClip = page.locator('.si-playfield')
		const dailyRun = page.getByRole('button', { name: /daily run/i })
		const freePlay = page.getByRole('button', { name: /free play/i })
		await freePlay.scrollIntoViewIfNeeded()
		await expect(freePlay).toBeVisible()
		await expectContainedWithin(dailyRun, stageClip, 'daily run overlay action')
		await expectContainedWithin(freePlay, stageClip, 'free play overlay action')
		await freePlay.click()
		await expect(page.locator('.si-phase--playing')).toContainText('Free play')
	})
})


for (const [width, height] of [[320, 568], [375, 667], [390, 844], [667, 320], [844, 390]]) {
  test(`contains the playing arena and HUD at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.addInitScript(() => localStorage.setItem('memba.space-invaders.best', '999999'))
    const network = await resolveNetwork(page)
    await page.goto(`/${network}/game/space-invaders`)
    await page.getByRole('button', { name: /free play/i }).click()
    await expect(page.locator('.si-phase--playing')).toBeVisible()
    const root = page.locator('.si-root')
    const canvas = page.locator('.si-canvas')
    for (const [item, label] of [[canvas, 'arena'], [page.locator('.si-hud'), 'HUD']] as const) {
      await expectContainedWithin(item, root, label)
      const box = (await item.boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(-1)
      expect(box.y + box.height).toBeLessThanOrEqual(height + 1)
    }
    const nav = page.getByRole('navigation', { name: 'Mobile navigation' })
    if (await nav.isVisible()) {
      const navBox = (await nav.boundingBox())!
      for (const item of [canvas, page.locator('.si-hud')]) {
        const box = (await item.boundingBox())!
        expect(box.y + box.height).toBeLessThanOrEqual(navBox.y + 1)
      }
    }
    const arena = (await canvas.boundingBox())!
    expect(arena.width / arena.height).toBeCloseTo(0.8, 2)
    expect(await root.evaluate(el => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    expect(await truncatedHudText(page)).toEqual([])
    for (const name of ['Pause', 'Mute']) {
      const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
    }
  })
}


for (const [width, height] of [[390, 844], [844, 390]]) {
  test(`keeps completed results and their controls accessible at ${width}x${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height })
    // Speed up wall time only: the real fixed-step engine and recorder still
    // produce the terminal run and its independently replay-checked outcome.
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window)
      window.requestAnimationFrame = callback => raf(time => callback(time * 20))
    })
    const network = await resolveNetwork(page)
    await page.goto(`/${network}/game/space-invaders`)
    await page.getByRole('button', { name: /free play/i }).click()
    const result = page.locator('.si-gameover')
    await expect(result.getByRole('heading', { name: /game over/i })).toBeVisible({ timeout: 45000 })
    await expect(result).toContainText('Free play · Replay checked on this device')
    const score = await page.getByTestId('si-final-score').textContent()
    await testInfo.attach(`result-${width}x${height}`, { body: await page.screenshot(), contentType: 'image/png' })
    for (const name of [/play again/i, /share result/i, /^menu$/i]) {
      const control = result.getByRole('button', { name })
      await control.scrollIntoViewIfNeeded()
      await expectContainedWithin(control, page.locator('.si-playfield'), 'result control')
    }
    await result.getByRole('button', { name: /^menu$/i }).click()
    await page.getByRole('button', { name: /back to result/i }).click()
    await expect(result.getByRole('heading', { name: /game over/i })).toBeFocused()
    await expect(page.getByTestId('si-final-score')).toHaveText(score!)
    await expect(result).toContainText('Replay checked on this device')
  })
}
