import { test, expect } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'
import { fulfillGovernance } from '../helpers/proGovernanceFixture'

test('guest Radio plays, survives minimising, changes station and stops on close', async ({ page }) => {
    await fulfillGovernance(page)
    await page.route('**/rpc.onyx.testnets.gno.land*/**', async route => {
        if (route.request().method() === 'GET') return route.fulfill({ json: { result: { node_info: { network: 'onyx-1' }, sync_info: { latest_block_height: '100' } } } })
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
    await page.goto(`${OS_ON}/os/radio`)
    const player = page.getByRole('region', { name: 'Radio player' })
    await expect(player).toContainText('Onyx testnet')
    await player.getByRole('button', { name: 'Play radio' }).click()
    await expect(player).toContainText('Dead World')
    await expect(player).toContainText('Aquatone')
    await expect(player.getByRole('status')).toHaveText('Live')
    await expect.poll(() => page.evaluate(() => (window as unknown as { radioTest: { time: number } }).radioTest.time)).toBeGreaterThanOrEqual(20)
    await page.getByRole('button', { name: 'Minimise Radio' }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { radioTest: { playing: boolean } }).radioTest.playing)).toBe(true)
    await page.getByRole('button', { name: 'Restore Radio', exact: true }).click()
    await expect(player).toBeVisible()
    await player.getByLabel('Station', { exact: true }).selectOption('1')
    await expect(player.getByRole('status')).toHaveText('Live')
    await page.screenshot({ path: '/private/tmp/memba-quick-tests/radio-desktop.png' })
    await page.getByRole('button', { name: 'Close Radio' }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { radioTest: { playing: boolean } }).radioTest.playing)).toBe(false)
})
