import { test, expect, type Page } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'
import { fulfillGovernance } from '../helpers/proGovernanceFixture'

async function radioFixture(page: Page, failing = false) {
    await fulfillGovernance(page)
    await page.route('**/rpc.onyx.testnets.gno.land*/**', async route => {
        if (route.request().method() === 'GET') return route.fulfill({ json: { result: { node_info: { network: 'onyx-1' }, sync_info: { latest_block_height: '100' } } } })
        if (failing) return route.fulfill({ status: 503, body: 'Unavailable' })
        const req = route.request().postDataJSON()
        const expr = Buffer.from(req.params.data, 'base64').toString()
        const station = expr.includes('ScheduleJSON(1,') ? 1 : 0
        const value = expr.includes('StationsJSON') ? { stations: [{ id: 0, name: 'Main' }, { id: 1, name: 'Ambient' }] }
            : expr.includes('ScheduleJSON') ? { station, now: 100, entries: [{ track: 1, start: 80, end: 140 }] }
                : { id: 1, title: 'Dead World', artistName: 'Aquatone', audio: 'https://archive.org/song.mp3', cover: '', source: 'https://archive.org/details/album', license: 'CC-BY-4.0', attribution: 'Aquatone, CC BY 4.0' }
        return route.fulfill({ json: { result: { response: { ResponseBase: { Error: null, Data: Buffer.from(`(${JSON.stringify(JSON.stringify(value))} string)`).toString('base64') } } } } })
    })
    await page.addInitScript(() => {
        const state = { playing: false, time: 0 }
        Object.assign(window, { radioTest: state })
        class AudioStub {
            src = ''; duration = 300; volume = .65; currentTime = 0
            onplaying: (() => void) | null = null; onpause: (() => void) | null = null; onloadedmetadata: (() => void) | null = null
            play() { state.playing = true; this.onplaying?.(); return Promise.resolve() }
            pause() { state.playing = false; this.onpause?.() }
            load() { this.onloadedmetadata?.(); state.time = this.currentTime }
            removeAttribute() { this.src = '' }
        }
        Object.defineProperty(window, 'Audio', { value: AudioStub })
    })
}

test('Radio is a compact utility, plays while hidden and survives desktop-to-phone navigation', async ({ page }, testInfo) => {
    await radioFixture(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`${OS_ON}/os/radio`)
    const player = page.getByRole('region', { name: 'Radio player', exact: true })
    await expect(player).toBeVisible()
    await expect(page.locator('[data-win="app:radio"]')).toHaveCount(0)
    await expect(player.getByRole('region', { name: 'Radio controls' })).toHaveCount(0)
    const box = await player.boundingBox()
    expect(box?.width).toBe(320)
    expect(box?.height).toBe(72)
    await player.getByRole('button', { name: 'Play radio' }).click()
    await expect(player).toContainText('Dead World')
    await expect(player.getByRole('status')).toHaveText('Aquatone · Main')
    await expect.poll(() => page.evaluate(() => (window as unknown as { radioTest: { time: number } }).radioTest.time)).toBeGreaterThanOrEqual(20)
    await player.getByRole('button', { name: 'Radio controls', exact: true }).click()
    await expect(player).toContainText('Onyx testnet')
    await expect(player.getByRole('link', { name: 'Track source' })).toHaveAttribute('href', 'https://archive.org/details/album')
    await page.keyboard.press('Escape')
    await expect(player.getByRole('button', { name: 'Radio controls', exact: true })).toBeFocused()
    await player.getByRole('button', { name: 'Radio controls', exact: true }).click()
    await player.getByRole('button', { name: 'Hide widget' }).click()
    await expect(player).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Show Radio', exact: true })).toBeFocused()
    await expect.poll(() => page.evaluate(() => (window as unknown as { radioTest: { playing: boolean } }).radioTest.playing)).toBe(true)
    await page.getByRole('button', { name: 'Show Radio', exact: true }).click()
    await expect(player.getByRole('button', { name: 'Pause radio' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('radio-widget-desktop.png') })
    // The same shell owner survives a responsive layout change without stopping the stream.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(player).toBeVisible()
    await page.getByRole('navigation', { name: 'Dock' }).getByRole('button', { name: 'Wallet', exact: true }).click()
    await expect(player.getByRole('button', { name: 'Pause radio' })).toBeVisible()
    await player.getByRole('button', { name: 'Radio controls', exact: true }).click()
    await player.getByLabel('Station', { exact: true }).selectOption('1')
    await expect(player.getByRole('status')).toHaveText('Aquatone · Ambient')
    await player.getByRole('slider', { name: 'Radio volume' }).fill('0.23')
    await player.getByRole('button', { name: 'Mute radio' }).click()
    await expect(player.getByRole('slider')).toHaveValue('0')
    await player.getByRole('button', { name: 'Unmute radio' }).click()
    await expect(player.getByRole('slider')).toHaveValue('0.23')
    const phoneBox = await player.boundingBox()
    expect(phoneBox!.x).toBeGreaterThanOrEqual(0)
    expect(phoneBox!.x + phoneBox!.width).toBeLessThanOrEqual(390)
    await page.screenshot({ path: testInfo.outputPath('radio-widget-phone.png') })
    await player.getByRole('button', { name: 'Stop radio' }).click()
    await expect(player).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => (window as unknown as { radioTest: { playing: boolean } }).radioTest.playing)).toBe(false)
    await page.getByRole('button', { name: 'Show Radio', exact: true }).click()
    await expect(player.getByRole('button', { name: 'Play radio' })).toBeVisible()
})

test('Radio offers a compact retry and reveals the service error only in controls', async ({ page }) => {
    await radioFixture(page, true)
    await page.goto(`${OS_ON}/os/radio`)
    const player = page.getByRole('region', { name: 'Radio player', exact: true })
    await expect(player.getByRole('button', { name: 'Retry radio' })).toBeVisible()
    await expect(player.getByRole('alert')).toHaveCount(0)
    await player.getByRole('button', { name: 'Retry radio' }).click()
    await expect(player.getByRole('button', { name: 'Retry radio' })).toBeVisible()
    await player.getByRole('button', { name: 'Radio controls', exact: true }).click()
    await expect(player.getByRole('alert')).toContainText('Check your connection and try again')
})

test('locking the shell stops a hidden Radio stream', async ({ page }) => {
    await radioFixture(page)
    await page.goto(`${OS_ON}/os/radio`)
    const player = page.getByRole('region', { name: 'Radio player', exact: true })
    await player.getByRole('button', { name: 'Play radio' }).click()
    await expect(player.getByRole('button', { name: 'Pause radio' })).toBeVisible()
    await player.getByRole('button', { name: 'Radio controls', exact: true }).click()
    await player.getByRole('button', { name: 'Hide widget' }).click()
    await page.getByRole('button', { name: 'Memba menu' }).click()
    await page.getByRole('menuitem', { name: 'Lock screen', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { radioTest: { playing: boolean } }).radioTest.playing)).toBe(false)
    await expect(page.getByRole('button', { name: 'Show Radio' })).toHaveCount(0)
})

for (const viewport of [{ width: 844, height: 390 }, { width: 667, height: 375 }, { width: 390, height: 844 }]) {
    test(`Radio controls remain reachable beside Meet PiP at ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
        await radioFixture(page)
        // Exercise the real Meet stage and responsive CSS without joining an external call.
        await page.route('https://visio.samourai.app/**', route => route.abort())
        await page.setViewportSize(viewport)
        await page.goto(`${OS_ON}/os/meet`)
        await page.getByRole('button', { name: 'New meeting', exact: true }).click()
        await expect(page.locator('.meet-stage iframe')).toBeAttached()
        await page.getByRole('navigation', { name: 'Dock' }).getByRole('button', { name: 'Wallet', exact: true }).click()
        const pip = page.locator('.meet-stage-pip')
        await expect(pip).toBeVisible()
        await page.getByRole('button', { name: 'Show Radio', exact: true }).click()
        const player = page.getByRole('region', { name: 'Radio player', exact: true })
        await player.getByRole('button', { name: 'Play radio' }).click()
        await expect(player.getByRole('button', { name: 'Pause radio' })).toBeVisible()
        await player.getByRole('button', { name: 'Radio controls', exact: true }).click()
        const controls = player.getByRole('region', { name: 'Radio controls', exact: true })
        // A positive visible scroll area, below the status bar and clear of the call and dock.
        // The broken landscape rule collapsed this area to padding, partly above the viewport.
        await expect.poll(async () => (await controls.boundingBox())!.height).toBeGreaterThanOrEqual(100)
        const statusBox = (await page.locator('.os-ph-status').boundingBox())!
        const dockBox = (await page.getByRole('navigation', { name: 'Dock' }).boundingBox())!
        const pipBox = (await pip.boundingBox())!
        for (const element of [player, controls]) {
            const box = (await element.boundingBox())!
            expect(box.y).toBeGreaterThanOrEqual(statusBox.y + statusBox.height)
            expect(box.y + box.height).toBeLessThanOrEqual(dockBox.y)
            expect(box.x).toBeGreaterThanOrEqual(0)
            expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
            expect(box.x + box.width <= pipBox.x || box.x >= pipBox.x + pipBox.width
                || box.y + box.height <= pipBox.y || box.y >= pipBox.y + pipBox.height).toBe(true)
        }
        await player.getByLabel('Station', { exact: true }).selectOption('1')
        await expect(player.getByRole('status')).toHaveText('Aquatone · Ambient')
        await player.getByRole('slider', { name: 'Radio volume' }).fill('0.23')
        await player.getByRole('button', { name: 'Mute radio' }).click()
        await expect(player.getByRole('slider')).toHaveValue('0')
        await player.getByRole('button', { name: 'Unmute radio' }).click()
        await expect(player.getByRole('slider')).toHaveValue('0.23')
        await page.screenshot({ path: testInfo.outputPath('radio-meet-pip.png') })
        await player.getByRole('button', { name: 'Hide widget' }).click()
        await expect(player).toHaveCount(0)
        await expect.poll(() => page.evaluate(() => (window as unknown as { radioTest: { playing: boolean } }).radioTest.playing)).toBe(true)
        await page.getByRole('button', { name: 'Show Radio', exact: true }).click()
        await player.getByRole('button', { name: 'Radio controls', exact: true }).click()
        await player.getByRole('button', { name: 'Stop radio' }).click()
        await expect(player).toHaveCount(0)
        await expect.poll(() => page.evaluate(() => (window as unknown as { radioTest: { playing: boolean } }).radioTest.playing)).toBe(false)
        await expect(pip).toBeVisible()
    })
}
