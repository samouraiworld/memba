import { expect, test } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'

for (const section of ['submit', 'review', 'my-submissions']) {
    test(`guest Store ${section} asks for an OS member session`, async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
        await page.goto(`${OS_ON}/os/store/${section}`)
        const win = page.getByRole('region', { name: 'App Store', exact: true })
        await expect(win.getByText('Connect a wallet to use App Store.')).toBeVisible()
        await expect(win.getByRole('button', { name: 'Connect' })).toBeVisible()
        await expect(win.locator('.os-classic')).toHaveCount(0)
    })
}

test('guest Store catalogue remains readable', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
    await page.route(/memba\.v1\.|\.gno\.land|gnolove|clerk[.-]/, route => route.abort())
    await page.goto(`${OS_ON}/os/store`)
    const win = page.getByRole('region', { name: 'App Store', exact: true })
    await expect(win.getByRole('navigation', { name: 'App Store' })).toBeVisible()
    await expect(win.getByRole('button', { name: 'Details for Adena' })).toBeVisible()
    await expect(win.getByRole('button', { name: 'Connect' })).toHaveCount(0)
})
