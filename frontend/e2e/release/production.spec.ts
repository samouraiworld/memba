import { test, expect, type Page } from '@playwright/test'

async function ready(page: Page) {
    await page.goto('/mainnet')
    await expect(page.getByTestId('home-spine-visitor')).toBeVisible()
    await page.waitForLoadState('networkidle')
    await page.evaluate(async () => {
        await navigator.serviceWorker.ready
        if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
    })
}
test.beforeEach(async ({ page, request }) => {
    await request.post('/__release?build=a')
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
    await page.addInitScript(() => {
        localStorage.setItem('memba_whats_new_seen', '7.7.0-release-a')
    })
})

test('a controlled old tab adopts build B, reloads B, and boots its cached shell offline', async ({ page, request, context }) => {
    await ready(page)
    const records = await page.evaluate(() => {
        const address = 'g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c'
        const data = {
            memba_dao_draft: JSON.stringify({ name: 'Unfinished DAO', description: '', realmPath: `gno.land/r/${address}/draft`, members: [{ address, power: 1, roles: ['admin'] }], threshold: 51, quorum: 0, availableRoles: ['admin'], proposalCategories: ['governance'], selectedPreset: null, step: 1, savedAt: Date.now() }),
            memba_pending_daos: JSON.stringify([{ chainId: 'gnoland-1', path: `gno.land/r/${address}/submitted`, name: 'Submitted DAO', txHash: 'FIXTURE_RECEIPT', reason: 'waiting', submittedAt: Date.now() }]),
        }
        for (const [key, value] of Object.entries(data)) localStorage.setItem(key, value)
        return data
    })
    const a = await (await request.get('/build-info.json')).json()
    expect(a.commit).toMatch(/^[a-f0-9]{40}$/)
    expect(a.entry).toMatch(/assets\/.*\.js$/)
    await request.post('/__release?build=b')
    const b = await (await request.get('/build-info.json')).json()
    expect(b.entry).not.toBe(a.entry)
    await page.evaluate(async () => {
        const controller = navigator.serviceWorker.controller
        const changed = new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
        await (await navigator.serviceWorker.ready).update()
        if (navigator.serviceWorker.controller === controller) await changed
    })
    // A service worker takeover alone must not force a page reload.
    expect(await page.locator('script[type=module]').getAttribute('src')).toBe('/' + a.entry)
    await page.reload()
    await expect(page.locator('script[type=module]')).toHaveAttribute('src', '/' + b.entry)
    await expect(page.locator('#main-content')).toBeVisible()
    await context.setOffline(true)
    await page.reload()
    await expect(page.locator('#main-content')).toBeVisible()
    await expect(page.locator('script[type=module]')).toHaveAttribute('src', '/' + b.entry)
    expect(await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(records))).toEqual(records)
})

test('a persistently missing lazy route reloads at most once across successful boots', async ({ page, request }) => {
    await ready(page)
    // Evict the specific precached lazy module, then fail it at the origin.
    const evicted = await page.evaluate(async () => {
        let count = 0
        for (const name of await caches.keys()) {
            const cache = await caches.open(name)
            for (const req of await cache.keys()) if (/\/Blog-.*\.js/.test(req.url) && await cache.delete(req)) count++
        }
        return count
    })
    expect(evicted).toBeGreaterThan(0)
    await request.post('/__release?break=Blog-')
    let navigations = 0
    page.on('request', req => { if (req.isNavigationRequest() && req.frame() === page.mainFrame()) navigations++ })
    await page.locator('a[href="/mainnet/blog"]:visible').first().click()
    await expect(page.getByRole('heading', { name: 'Page could not load' })).toBeVisible()
    expect(navigations).toBeLessThanOrEqual(1)
    expect(await page.evaluate(() => sessionStorage.getItem('memba_chunk_reload'))).toBe('1')
    await expect(page.getByRole('button', { name: 'Reload Page' })).toBeEnabled()
})

test('blocked session storage does not prevent the shell or cause automatic reload', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('Denied', 'SecurityError') } })
    })
    await ready(page)
    let navigations = 0
    page.on('request', req => { if (req.isNavigationRequest() && req.frame() === page.mainFrame()) navigations++ })
    const suppressed = await page.evaluate(() => !window.dispatchEvent(new Event('vite:preloadError', { cancelable: true })))
    expect(suppressed).toBe(false)
    expect(navigations).toBe(0)
    await expect(page.locator('#main-content')).toBeVisible()
})
