import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { OS_ON } from '../../playwright.os.config'
import { devReportFixture } from '../helpers/devReportFixture'

for (const theme of ['light', 'dark'] as const) {
    test(`repository catalogue works in an OS window (${theme})`, async ({ page, browserName }) => {
        await page.emulateMedia({ colorScheme: theme })
        await page.addInitScript(() => {
            localStorage.setItem('memba_os_skip_intro', '1')
            localStorage.setItem('memba_os_booted', '1')
        })
        await devReportFixture(page)
        await page.goto(`${OS_ON}/os/dev-report/repositories`)
        const app = page.locator('.os-classic').filter({ has: page.getByRole('heading', { name: 'Repositories', exact: true }) })
        await expect(app).toBeVisible()
        await expect(app.getByText('67', { exact: true })).toBeVisible()
        const navigation = app.getByRole('navigation', { name: 'Gnolove section navigation' })
        expect(await navigation.evaluate(el => getComputedStyle(el).flexWrap)).toBe('nowrap')
        const violations = (await new AxeBuilder({ page }).include('.gl-repositories').analyze()).violations
        expect(violations).toEqual([])
        await page.screenshot({ path: `/private/tmp/devreport-os-${theme}-${browserName}.png` })
        await page.setViewportSize({ width: 390, height: 844 })
        await app.getByRole('searchbox').fill('memba')
        await expect(app.getByRole('link', { name: 'samouraiworld/memba', exact: true })).toBeVisible()
        expect(await app.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        await app.getByRole('link', { name: 'samouraiworld/memba', exact: true }).click()
        await expect(page).toHaveURL(/\/os\/dev-report\?repos=samouraiworld%2Fmemba/)
    })
}
