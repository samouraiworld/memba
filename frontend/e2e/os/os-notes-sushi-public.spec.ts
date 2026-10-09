import { test, expect, type Page } from '@playwright/test'
const url = '/e2e-notes/sushi/index.html'
const key = 'memba_os_desk:v3:local-sushi-demonstration:guest'
const errors: string[] = []
async function monitor(page: Page) {
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => {
        const request = route.request(), target = new URL(request.url())
        if (target.hostname === '127.0.0.1' && target.port === '6996' && request.method() === 'GET') return route.continue()
        errors.push(`Unexpected request: ${request.method()} ${target.origin}`); return route.abort()
    })
}
test.beforeEach(async ({ page }) => { errors.length = 0; await monitor(page) })
test.afterEach(() => { expect(errors).toEqual([]) })
async function openSushi(page: Page) {
    await page.goto(url)
    await expect(page.getByRole('heading', { name: 'Local demonstration / simulated network', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Open Sushi recipe', exact: true }).click()
    await expect(page.getByRole('article', { name: 'Note preview' })).toHaveAttribute('data-rendered', 'html')
}
test('guest opens the real reader and Worker-rendered full recipe without a signature', async ({ page }, testInfo) => {
    await openSushi(page)
    const preview = page.getByRole('article', { name: 'Note preview' })
    await expect(preview.getByRole('heading', { name: 'Avocado & cucumber maki', exact: true })).toBeVisible()
    await expect(preview.getByRole('table')).toBeVisible()
    await expect(preview.getByRole('cell', { name: '300 g', exact: true })).toBeVisible()
    await expect(preview.getByRole('checkbox')).toHaveCount(3)
    await expect(preview.getByRole('checkbox').nth(0)).toBeChecked()
    await expect(preview.getByRole('checkbox').nth(1)).not.toBeChecked()
    await expect(preview.getByRole('checkbox').nth(0)).toBeDisabled()
    await expect(preview.getByText('This recipe is a demonstration document.', { exact: false })).toBeVisible()
    await expect(preview.locator('a[href^="#"]')).not.toHaveCount(0)
    await expect(page.getByText('No comments on this page.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Review comment|Edit note|Delete comment|Resolve thread|Hide comment/ })).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText('Guest reading only — no wallet or signature.', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('sushi-reading.png'), fullPage: true })
    const stored = await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!), key)
    expect(stored.version).toBe(3); expect(stored.releases['sushi-v1'].status).toBe('seeded'); expect(stored.releases['whitepaper-v1'].status).toBe('pending')
})
test('reload preserves one icon, dismissal remains absent after reload', async ({ page }) => {
    await openSushi(page); await page.reload()
    await expect(page.getByRole('button', { name: 'Open Sushi recipe', exact: true })).toHaveCount(1)
    await page.getByRole('button', { name: 'Dismiss Sushi recipe', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Open Sushi recipe', exact: true })).toHaveCount(0)
    await page.reload(); await expect(page.getByLabel('Seed state')).toContainText('dismissed')
    await expect(page.getByRole('button', { name: 'Open Sushi recipe', exact: true })).toHaveCount(0)
})
test('future Whitepaper has an independent seed and does not resurrect dismissed Sushi', async ({ page }) => {
    await openSushi(page)
    await page.getByRole('button', { name: 'Dismiss Sushi recipe', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Open Sushi recipe', exact: true })).toHaveCount(0)
    await page.getByLabel('Include future Whitepaper demonstration').check()
    await page.getByRole('button', { name: 'Open Whitepaper', exact: true }).click()
    await expect(page.getByRole('article', { name: 'Note preview' })).toHaveAttribute('data-rendered', 'html')
    await expect(page.getByRole('heading', { name: 'Future Whitepaper demonstration', exact: true })).toBeVisible()
    const stored = await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!), key)
    expect(stored.releases['sushi-v1'].status).toBe('dismissed'); expect(stored.releases['whitepaper-v1'].status).toBe('seeded')
    await page.reload(); await expect(page.getByRole('button', { name: 'Open Whitepaper', exact: true })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Open Sushi recipe', exact: true })).toHaveCount(0)
})

test('two concurrent tabs dismiss separate releases without losing either decision', async ({ page, context }) => {
    await openSushi(page)
    await page.getByLabel('Include future Whitepaper demonstration').check()
    await expect(page.getByRole('button', { name: 'Open Whitepaper', exact: true })).toBeVisible()
    const peer = await context.newPage(); await monitor(peer); await peer.goto(url)
    for (const tab of [page, peer]) {
        await expect(tab.getByRole('button', { name: 'Open Sushi recipe', exact: true })).toBeVisible()
        await expect(tab.getByRole('button', { name: 'Open Whitepaper', exact: true })).toBeVisible()
    }
    await Promise.all([page.getByRole('button', { name: 'Dismiss Sushi recipe', exact: true }).click(), peer.getByRole('button', { name: 'Dismiss Whitepaper', exact: true }).click()])
    for (const tab of [page, peer]) {
        await expect(tab.getByLabel('Seed state')).toContainText('"sushi-v1":{"status":"dismissed"}')
        await expect(tab.getByLabel('Seed state')).toContainText('"whitepaper-v1":{"status":"dismissed"}')
    }
    await Promise.all([page.reload(), peer.reload()])
    for (const tab of [page, peer]) {
        await expect(tab.getByLabel('Seed state')).toContainText('"sushi-v1":{"status":"dismissed"}')
        await expect(tab.getByLabel('Seed state')).toContainText('"whitepaper-v1":{"status":"dismissed"}')
        await expect(tab.getByRole('button', { name: /^Open (Sushi recipe|Whitepaper)$/ })).toHaveCount(0)
    }
    await peer.close()
})
