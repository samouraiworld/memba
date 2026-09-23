import { test, expect } from '@playwright/test'

const HASH = 'LEDHNAXCxlrRMTKCsmlLNDMkIK1eLhfWUGxSAzFcEV4='
const HEX = '2c40c73405c2c65ad1313282b2694b34332420ad5e2e17d6506c5203315c115e'
const REALM = 'gno.land/r/demo/one'
const PACKAGE = 'gno.land/p/demo/two'
const response = {
    chainId: 'gnoland-1', source: 'official-mainnet-tx-indexer', checkedAt: '2026-09-22T14:26:04Z',
    indexedHeight: 20_000, windowStart: 9_801, windowEnd: 20_000, coverage: 'window-only',
    rows: [
        { path: REALM, kind: 'realm', creator: 'g1realm', txHash: HASH, blockHeight: 20_000, txIndex: 1 },
        { path: PACKAGE, kind: 'package', creator: 'g1package', txHash: HASH, blockHeight: 19_999, txIndex: 0 },
    ],
}

for (const viewport of [{ name: 'desktop', width: 1280, height: 800 }, { name: '390 px', width: 390, height: 844 }]) {
    test(`mainnet submissions stay separate and other networks stay empty at ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        let calls = 0
        await page.route('**/api/directory/recent-submissions', async route => {
            calls++
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
        })

        await page.goto('/mainnet/directory?tab=packages')
        const section = page.getByRole('region', { name: 'Recent package submissions · gno.land' })
        await expect(section.getByText(PACKAGE)).toBeVisible()
        await expect(section.getByText(REALM)).toHaveCount(0)
        await expect(section.getByText('Added on chain; activation not checked.')).toBeVisible()
        await expect(section.getByRole('link', { name: /Transaction for/ })).toHaveAttribute('href', `https://rpc.gno.land/tx?hash=0x${HEX}`)
        await expect(section.getByRole('link', { name: /Block 19999 for/ })).toHaveAttribute('href', 'https://rpc.gno.land/block?height=19999')
        await expect(section.getByText(/checked at 14:26 UTC/)).toBeVisible()
        const packageCalls = calls
        expect(packageCalls).toBeGreaterThanOrEqual(1)
        await page.waitForTimeout(250)
        expect(calls).toBe(packageCalls) // no polling after the page settles
        if (viewport.width === 390) {
            expect(await section.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
        }

        await page.goto('/mainnet/directory?tab=realms')
        const realms = page.getByRole('region', { name: 'Recent package submissions · gno.land' })
        await expect(realms.getByText(REALM)).toBeVisible()
        await expect(realms.getByText(PACKAGE)).toHaveCount(0)
        const realmCalls = calls
        expect(realmCalls).toBeGreaterThan(packageCalls)

        // The lane is mainnet-only. Pearl was the non-mainnet case until its
        // 2026-09-23 retirement (/pearl/ now redirects to /mainnet/); test13 is
        // a hidden, non-retired network that still resolves by URL.
        await page.goto('/test13/directory?tab=packages')
        await expect(page.getByRole('region', { name: 'Recent package submissions · gno.land' })).toHaveCount(0)
        expect(calls).toBe(realmCalls)
    })
}

test('submission heading and disclosure remain legible in dark mode at 390 px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => localStorage.setItem('memba_theme', 'dark'))
    await page.route('**/api/directory/recent-submissions', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) }))
    await page.goto('/mainnet/directory?tab=packages')
    const section = page.getByRole('region', { name: 'Recent package submissions · gno.land' })
    await expect(section.getByText(PACKAGE)).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    const contrast = await section.evaluate(node => {
        const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
        const luminance = (value: string) => {
            const [r, g, b] = rgb(value).map(channel => {
                const normalized = channel / 255
                return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
            })
            return 0.2126 * r + 0.7152 * g + 0.0722 * b
        }
        const surface = getComputedStyle(node).backgroundColor
        const surfaceChannels = rgb(surface)
        const opacity = Number(surface.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1] ?? 1)
        const bodyChannels = rgb(getComputedStyle(document.body).backgroundColor)
        const background = luminance(`rgb(${surfaceChannels.map((channel, index) =>
            channel * opacity + bodyChannels[index] * (1 - opacity)).join(',')})`)
        const ratio = (selector: string) => {
            const target = node.querySelector(selector)
            if (!target) return 0
            const foreground = luminance(getComputedStyle(target).color)
            return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)
        }
        return { heading: ratio('h2'), disclosure: ratio('.dir-recent__heading p') }
    })
    expect(contrast.heading).toBeGreaterThanOrEqual(4.5)
    expect(contrast.disclosure).toBeGreaterThanOrEqual(4.5)
    expect(await section.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
})

// The Refresh/Retry button is disabled while any read is in flight — including
// the first load, which is when axe scans usually land. It used to fade to
// opacity 0.6 (≈4.2:1, an axe color-contrast failure); the label must keep
// ≥4.5:1 against its own surface while disabled, in both themes.
for (const theme of ['light', 'dark'] as const) {
    test(`refresh stays legible while a refetch is in flight (${theme})`, async ({ page }) => {
        await page.addInitScript(t => localStorage.setItem('memba_theme', t), theme)
        let release: () => void = () => {}
        const held = new Promise<void>(resolve => { release = resolve })
        let holding = false
        await page.route('**/api/directory/recent-submissions', async route => {
            if (holding) await held // hold the clicked refetch so the disabled state is observable
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
        })
        await page.goto('/mainnet/directory?tab=packages')
        const section = page.getByRole('region', { name: 'Recent package submissions · gno.land' })
        await expect(section.getByText(PACKAGE)).toBeVisible()
        const button = section.getByRole('button', { name: 'Refresh' })
        await expect(button).toBeEnabled()
        holding = true
        await button.click()
        await expect(button).toBeDisabled()

        const measured = await button.evaluate(node => {
            const channels = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number)
            const over = (top: number[], bottom: number[]) => {
                const alpha = top[3] ?? 1
                return [0, 1, 2].map(i => top[i] * alpha + bottom[i] * (1 - alpha))
            }
            // Resolve the button's effective surface: its own background over
            // every translucent ancestor, down to the page.
            const stack: number[][] = []
            for (let el: Element | null = node; el; el = el.parentElement) stack.push(channels(getComputedStyle(el).backgroundColor))
            let surface = [255, 255, 255]
            for (const layer of stack.reverse()) surface = over(layer, surface)
            // Element opacity blends the label toward the surface it sits on.
            let opacity = 1
            for (let el: Element | null = node; el; el = el.parentElement) opacity *= Number(getComputedStyle(el).opacity)
            const text = over([...channels(getComputedStyle(node).color).slice(0, 3), opacity], surface)
            const luminance = (rgb: number[]) => {
                const [r, g, b] = rgb.map(c => { const n = c / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4 })
                return 0.2126 * r + 0.7152 * g + 0.0722 * b
            }
            const [a, b] = [luminance(text), luminance(surface)]
            return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), opacity, cursor: getComputedStyle(node).cursor }
        })
        expect(measured.opacity).toBe(1)
        expect(measured.ratio).toBeGreaterThanOrEqual(4.5)
        expect(measured.cursor).toBe('wait')

        release()
        await expect(button).toBeEnabled()
    })
}
