import { expect, test, type Page } from '@playwright/test'
import { OS_ON } from '../../playwright.os.config'
import { fulfillProValidatorRoster } from '../helpers/proValidatorsFixture'

async function fixture(page: Page, width: number) {
    await page.route('**/*', route => {
        const host = new URL(route.request().url()).hostname
        return host === '127.0.0.1' ? route.continue() : route.abort()
    })
    await fulfillProValidatorRoster(page)
    await page.addInitScript(() => {
        localStorage.setItem('memba_os_seen', '1')
        localStorage.setItem('memba_os_windows:guest:gnoland-1', JSON.stringify([
            { token: 'app.validators', x: 40, y: 20, width: 360, height: 640, z: 1, min: false, max: false },
        ]))
    })
    await page.setViewportSize({ width, height: 800 })
}

test('Validators tabs stay fully visible in a 360 px desktop window', async ({ page }) => {
    await fixture(page, 1280)
    await page.goto(`${OS_ON}/os/validators`)
    const win = page.getByRole('region', { name: 'Validators', exact: true })
    const tabs = win.getByRole('tablist', { name: 'Validators sections' })
    await expect(tabs).toBeVisible()
    await expect(win.locator('.val-segtabs')).toHaveCSS('display', 'grid')
    const bounds = await tabs.evaluate(el => {
        const strip = el.getBoundingClientRect()
        const buttons = [...el.querySelectorAll('button')].map(button => button.getBoundingClientRect())
        return {
            spill: el.scrollWidth - el.clientWidth,
            allInside: buttons.every(rect => rect.left >= strip.left - 1 && rect.right <= strip.right + 1),
        }
    })
    expect(bounds.spill).toBeLessThanOrEqual(1)
    expect(bounds.allInside).toBe(true)
    await win.getByTestId('seg-network').click()
    await expect(win.getByTestId('seg-network')).toHaveAttribute('aria-selected', 'true')
    await expect(win.locator('.val-roster__table-wrap')).toBeVisible()
})

test('Validator profile fits a 360 px desktop window with a readable address', async ({ page }) => {
    await fixture(page, 1280)
    await page.goto(`${OS_ON}/os/validators/g1mockval0000000000000000000000000000001`)
    const win = page.getByRole('region', { name: 'Validators', exact: true })
    const profile = win.getByTestId('validator-profile-page')
    await expect(profile.getByRole('heading', { name: 'Northstar' })).toBeVisible()
    await expect(profile.locator('.vp-id')).toHaveCSS('flex-direction', 'column')
    await expect(profile.locator('.vd-row').first()).toHaveCSS('flex-direction', 'column')
    const layout = await profile.evaluate(el => {
        const address = el.querySelector('.vd-row__value')!.getBoundingClientRect()
        return {
            spill: el.scrollWidth - el.clientWidth,
            addressWidth: address.width,
            addressInside: address.right <= el.getBoundingClientRect().right + 1,
        }
    })
    expect(layout.spill).toBeLessThanOrEqual(1)
    expect(layout.addressWidth).toBeGreaterThan(180)
    expect(layout.addressInside).toBe(true)
})

test('Validators tabs fit a 320 px phone viewport', async ({ page }) => {
    await fixture(page, 320)
    await page.goto(`${OS_ON}/os/validators`)
    const tabs = page.getByRole('tablist', { name: 'Validators sections' })
    await expect(tabs).toBeVisible()
    expect(await tabs.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    await expect(page.getByTestId('seg-network')).toBeVisible()
})

test('Roster search explains zero matches and restores context after a profile visit', async ({ page }) => {
    await fixture(page, 1280)
    await page.goto(`${OS_ON}/os/validators`)
    const win = page.getByRole('region', { name: 'Validators', exact: true })
    const search = win.getByRole('textbox', { name: 'Search validators' })
    await expect(search).toBeVisible()
    await search.fill('__no_validator_matches__')
    await expect(win.getByRole('heading', { name: 'No matching validators' })).toBeVisible()
    await win.getByRole('button', { name: 'Clear filters' }).click()
    await expect(search).toHaveValue('')
    await search.fill('Northstar')
    await expect(page).toHaveURL(/q=Northstar/)
    await win.getByRole('link', { name: 'Northstar', exact: true }).click()
    await expect(win.getByTestId('validator-profile-page')).toBeVisible()
    const back = win.getByRole('link', { name: '← Validators' })
    await expect(back).toHaveAttribute('href', /q=Northstar/)
    await back.click()
    await expect(search).toHaveValue('Northstar')
    await expect(win.getByRole('link', { name: 'Northstar', exact: true })).toBeVisible()
})

test('Profile return link restores the Candidates segment in OS', async ({ page }) => {
    await fixture(page, 1280)
    await page.goto(`${OS_ON}/os/validators/g1mockval0000000000000000000000000000001?from=tab%3Dcandidates`)
    const win = page.getByRole('region', { name: 'Validators', exact: true })
    const back = win.getByRole('link', { name: '← Validators' })
    await expect(back).toHaveAttribute('href', '/os/validators?tab=candidates')
    await back.click()
    await expect(win.getByTestId('seg-candidates')).toHaveAttribute('aria-selected', 'true')
})
