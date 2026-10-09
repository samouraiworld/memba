import { expect, test, type Page } from '@playwright/test'
const url = '/e2e-notes/sushi-desk/index.html', sushi = '74'.repeat(16), paper = '76'.repeat(16)
const errors: string[] = []
async function desktop(page: Page, query = '') {
    await page.goto(url + query)
    await expect(page.getByText('Simulated local Notes desk — no wallet or RPC', { exact: true })).toBeVisible()
}
function icon(page: Page, label: string) { return page.getByRole('button', { name: label, exact: true }).filter({ has: page.locator('.os-tile') }) }
async function dismiss(page: Page, label: string) {
    await icon(page, label).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Remove from desktop', exact: true }).click()
    await expect(icon(page, label)).toHaveCount(0)
}
async function desk(page: Page, guest = false) {
    return page.evaluate(isGuest => {
        const keys = Object.keys(localStorage).filter(key => key.startsWith('memba_os_desk:v3:'))
        const key = keys.find(key => isGuest ? key.endsWith(':guest') : !key.endsWith(':guest'))
        return key ? { key, ...JSON.parse(localStorage.getItem(key)!) } : null
    }, guest)
}
test.beforeEach(async ({ page, context }) => {
    errors.length = 0
    context.on('page', peer => peer.on('pageerror', error => errors.push(error.message)))
    page.on('pageerror', error => errors.push(error.message))
    await context.route('**/*', route => {
        const target = new URL(route.request().url())
        return target.hostname === '127.0.0.1' && target.port === '6998' && route.request().method() === 'GET' ? route.continue() : route.abort()
    })
})
test.afterEach(() => { expect(errors).toEqual([]) })
async function healthyPublicWorkspace(page: Page, guest: boolean) {
    const history = page.getByRole('region', { name: 'Public history', exact: true })
    await expect(history.getByText('No public history is available for this note.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit note', exact: true })).toHaveCount(guest ? 0 : 1)
    const settings = page.getByRole('region', { name: 'Community editing settings', exact: true })
    if (guest) await expect(settings).toHaveCount(0)
    else await expect(settings.getByText('Public content editing is disabled.', { exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
}
for (const guest of [false, true]) test(`${guest ? 'guest' : 'member'} real desktop icon opens the reader and keeps its label on phone`, async ({ page }, info) => {
    await desktop(page, guest ? '?guest=1' : '')
    await expect(icon(page, 'Sushi recipe')).toHaveCount(1)
    await icon(page, 'Sushi recipe').click()
    await expect(page.getByRole('heading', { name: 'Sushi Shell demonstration', exact: true })).toBeVisible()
    await expect(page.getByRole('article', { name: 'Note preview' })).toHaveAttribute('data-rendered', 'html')
    await healthyPublicWorkspace(page, guest)
    await page.getByRole('button', { name: 'Close Notes', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(icon(page, 'Sushi recipe')).toBeVisible()
    await icon(page, 'Sushi recipe').click()
    await expect(page.getByRole('heading', { name: 'Sushi Shell demonstration', exact: true })).toBeVisible()
    const preview = page.getByRole('article', { name: 'Note preview' })
    await expect(preview).toHaveAttribute('data-rendered', 'html')
    await expect(preview.getByRole('heading', { name: 'Avocado & cucumber maki', exact: true })).toBeVisible()
    await expect(preview.getByRole('table')).toBeVisible()
    await healthyPublicWorkspace(page, guest)
    expect((await desk(page, guest)).releases['sushi-v1']).toEqual({ status: 'seeded', noteId: sushi })
    await page.screenshot({ path: info.outputPath('real-phone-sushi.png'), animations: 'disabled' })
})
test('dismiss survives reload and real Shell disconnect/reconnect; Whitepaper is independent', async ({ page }) => {
    await desktop(page); await dismiss(page, 'Sushi recipe'); await page.reload()
    await expect.poll(async () => (await desk(page))?.releases['sushi-v1'].status).toBe('dismissed')
    await expect(icon(page, 'Sushi recipe')).toHaveCount(0)
    await page.getByRole('button', { name: 'Memba menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Disconnect & lock', exact: true }).click()
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Welcome to Memba' })).toHaveCount(0)
    await expect(icon(page, 'Sushi recipe')).toHaveCount(0)
    await desktop(page, '?paper=1'); await expect(icon(page, 'Whitepaper')).toHaveCount(1)
    await expect(icon(page, 'Sushi recipe')).toHaveCount(0)
    await icon(page, 'Whitepaper').click()
    await expect(page.getByRole('heading', { name: 'Future Whitepaper demonstration', exact: true })).toBeVisible()
    expect((await desk(page)).releases).toEqual({ 'sushi-v1': { status: 'dismissed' }, 'whitepaper-v1': { status: 'seeded', noteId: paper } })
})
test('two real Shell tabs retain both concurrent dismissals', async ({ page, context }) => {
    await desktop(page, '?paper=1'); const peer = await context.newPage(); await desktop(peer)
    for (const tab of [page, peer]) { await expect(icon(tab, 'Sushi recipe')).toBeVisible(); await expect(icon(tab, 'Whitepaper')).toBeVisible() }
    await Promise.all([dismiss(page, 'Sushi recipe'), dismiss(peer, 'Whitepaper')])
    for (const tab of [page, peer]) {
        await expect.poll(async () => (await desk(tab))?.releases).toEqual({ 'sushi-v1': { status: 'dismissed' }, 'whitepaper-v1': { status: 'dismissed' } })
        await expect(icon(tab, 'Sushi recipe')).toHaveCount(0); await expect(icon(tab, 'Whitepaper')).toHaveCount(0)
    }
    await Promise.all([page.reload(), peer.reload()])
    for (const tab of [page, peer]) { await expect(icon(tab, 'Sushi recipe')).toHaveCount(0); await expect(icon(tab, 'Whitepaper')).toHaveCount(0) }
    await peer.close()
})
test('full real desktop keeps every pin until removal frees a seed cell; Settings reset propagates', async ({ page, context }) => {
    await desktop(page); await expect(icon(page, 'Sushi recipe')).toBeVisible()
    const initial = await desk(page)
    const oldKey = `memba_os_desk:${initial.partition.wallet ?? 'guest'}`, oldBytes = JSON.stringify([{ ty: 'dao', ref: 'retained-old-pin', c: 0, r: 0 }])
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: oldKey, value: oldBytes })
    await page.evaluate(({ key, partition }) => {
        const items = Array.from({ length: 48 }, (_, index) => ({ ty: 'dao', ref: `slot${index}`, c: Math.floor(index / 6), r: index % 6 }))
        localStorage.setItem(key, JSON.stringify({ version: 3, partition, items, releases: { 'sushi-v1': { status: 'pending' }, 'whitepaper-v1': { status: 'pending' } }, resetToken: null }))
    }, initial)
    await page.reload(); await expect(page.locator('.os-thing')).toHaveCount(48); await expect(icon(page, 'Sushi recipe')).toHaveCount(0)
    await page.getByRole('button', { name: 'SL slot0', exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Remove from desktop', exact: true }).click()
    await expect(icon(page, 'Sushi recipe')).toBeVisible(); await expect(page.locator('.os-thing')).toHaveCount(48)
    const after = await desk(page); expect(after.items.filter((item: { ty: string }) => item.ty === 'dao')).toHaveLength(47)
    const peer = await context.newPage(); await desktop(peer); await expect(peer.locator('.os-thing')).toHaveCount(48)
    await page.getByRole('button', { name: 'Memba menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Safety', exact: true }).click()
    await page.getByRole('button', { name: 'Reset local app data', exact: true }).click()
    await page.evaluate(() => {
        const removed: string[] = [], original = Storage.prototype.removeItem
        Object.defineProperty(window, '__deskRemovedKeys', { value: removed })
        Storage.prototype.removeItem = function (key: string) { removed.push(key); return original.call(this, key) }
    })
    await page.getByRole('button', { name: 'Confirm reset', exact: true }).click()
    const removed = await page.evaluate(() => (window as unknown as { __deskRemovedKeys: string[] }).__deskRemovedKeys)
    expect(removed).toContain(initial.key); expect(removed).toContain(oldKey)
    expect(await page.evaluate(key => localStorage.getItem(key), oldKey)).toBeNull()
    for (const tab of [page, peer]) {
        await expect(icon(tab, 'Sushi recipe')).toBeVisible()
        await expect(tab.locator('.os-thing')).toHaveCount(1)
        await expect.poll(async () => (await desk(tab))?.items.length).toBe(1)
        expect((await desk(tab)).resetToken).not.toBeNull()
    }
    // An old-version tab may recreate its legacy bytes; the reset generation must ignore them.
    await peer.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: oldKey, value: oldBytes })
    await Promise.all([page.reload(), peer.reload()])
    for (const tab of [page, peer]) {
        await expect(tab.locator('.os-thing')).toHaveCount(1)
        await expect(icon(tab, 'Sushi recipe')).toBeVisible()
        expect((await desk(tab)).items[0].ref).toBe(sushi)
    }
    await peer.close()
})
