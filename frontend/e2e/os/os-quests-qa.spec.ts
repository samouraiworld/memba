import { expect, test, type Page } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'

async function guest(page: Page, width: number) {
    await page.route('**/*', route => {
        const host = new URL(route.request().url()).hostname
        return host === '127.0.0.1' ? route.continue() : route.abort()
    })
    await page.addInitScript(() => {
        localStorage.setItem('memba_os_seen', '1')
        localStorage.setItem('memba_os_windows:guest:gnoland-1', JSON.stringify([
            { token: 'app.quests', x: 30, y: 20, width: 360, height: 680, z: 1, min: false, max: false },
        ]))
    })
    await page.setViewportSize({ width, height: 800 })
}

// The hub is the native window; a quest's own page and the leaderboard are the classic pages inside it.
test('filtered Quest Hub returns from a deployment detail with its query intact', async ({ page }) => {
    await guest(page, 1400)
    await page.goto(`${OS_ON}/os/quests`)
    const win = page.getByRole('region', { name: 'Quests', exact: true })
    const developers = win.getByRole('group', { name: 'Category' }).getByRole('button', { name: /Developers/ })
    await developers.click()
    await expect(developers).toHaveAttribute('aria-pressed', 'true')
    await expect(page).toHaveURL(/category=developer/)
    await win.getByRole('button', { name: /^First Package/ }).click()
    await expect(win.getByRole('heading', { name: 'First Package' })).toBeVisible()
    await expect(win.getByText('Coming soon', { exact: true })).toHaveCount(0)
    // Opening a quest is a history entry: Back returns to the hub as it was filtered.
    await page.goBack()
    await expect(developers).toHaveAttribute('aria-pressed', 'true')
    await expect(page).toHaveURL(/category=developer/)
    await page.goForward()
    await expect(win.getByRole('heading', { name: 'First Package' })).toBeVisible()
    await expect(win.getByRole('link', { name: 'Back to Quest Hub' })).toHaveAttribute('href', '/os/quests?category=developer')
    await win.getByRole('link', { name: 'Back to Quest Hub' }).click()
    await expect(developers).toHaveAttribute('aria-pressed', 'true')
    await expect(page).toHaveURL(/category=developer/)
    await expect(win.locator('.os-classic')).toHaveCount(0)
})

test('the native hub opens the leaderboard in the same window, and the address bar follows', async ({ page }) => {
    await guest(page, 1400)
    await page.goto(`${OS_ON}/os/quests`)
    const win = page.getByRole('region', { name: 'Quests', exact: true })
    await win.getByRole('button', { name: 'Leaderboard' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/os/quests/leaderboard')
    await expect(win.locator('.k-leaderboard')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Quests', exact: true })).toHaveCount(1)
    await page.goBack()
    await expect(win.getByRole('heading', { level: 1, name: 'Quests' })).toBeVisible()
})

test('a 360 px OS window keeps XP visible in a populated leaderboard table', async ({ page }) => {
    await guest(page, 1400)
    await page.goto(`${OS_ON}/os/quests/leaderboard`)
    const win = page.getByRole('region', { name: 'Quests', exact: true })
    const board = win.locator('.k-leaderboard')
    await expect(board).toBeVisible()
    // Add representative rows after the guest request settles so the layout
    // assertion is deterministic even when the production API is unavailable.
    await board.evaluate(el => {
        const existing = el.querySelector('.k-leaderboard-table-wrap')
        existing?.remove()
        const fixture = document.createElement('div')
        fixture.className = 'k-leaderboard-table-wrap'
        fixture.innerHTML = '<table class="k-leaderboard-table"><thead><tr><th>#</th><th>Player</th><th>Rank</th><th>XP</th><th>Quests</th></tr></thead><tbody><tr><td>🥇</td><td><a class="k-leaderboard-addr">g1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</a></td><td>Gold Architect</td><td class="k-leaderboard-xp">350</td><td>12</td></tr></tbody></table>'
        el.append(fixture)
    })
    const layout = await board.locator('.k-leaderboard-table-wrap').evaluate(el => {
        const xp = el.querySelector('tbody td:nth-child(4)')!.getBoundingClientRect()
        const bounds = el.getBoundingClientRect()
        return { overflow: el.scrollWidth - el.clientWidth, xpVisible: xp.left >= bounds.left && xp.right <= bounds.right + 1 }
    })
    expect(layout.overflow).toBeLessThanOrEqual(1)
    expect(layout.xpVisible).toBe(true)
})
