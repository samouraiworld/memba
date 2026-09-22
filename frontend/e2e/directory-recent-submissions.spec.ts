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
    test(`mainnet submissions stay separate and Pearl stays empty at ${viewport.name}`, async ({ page }) => {
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

        await page.goto('/pearl/directory?tab=packages')
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
