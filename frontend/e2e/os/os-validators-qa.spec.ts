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

/** The window body's sideways spill, and whether the table and every control end inside it. */
async function fit(page: Page) {
    return page.locator('.os-wbody').first().evaluate(body => {
        const edge = body.getBoundingClientRect().right
        const inside = (selector: string) => [...body.querySelectorAll(selector)].every(el => el.getBoundingClientRect().right <= edge + 1)
        return {
            spill: body.scrollWidth - body.clientWidth,
            // The table fits by itself: it does not lean on its wrapper's own sideways scroll.
            table: inside('.os-t'),
            controls: inside('.os-segm button, .os-chipset button, .os-validators-search, .os-validators-head button'),
        }
    })
}

test('The Validators window fits a 360 px desktop window: both lists, the filters and a readable table', async ({ page }) => {
    await fixture(page, 1280)
    await page.goto(`${OS_ON}/os/validators`)
    const win = page.getByRole('region', { name: 'Validators', exact: true })
    // The view's own stylesheet has applied, and the roster has loaded.
    await expect(win.locator('.os-validators-tools')).toHaveCSS('display', 'flex')
    await expect(win.getByRole('button', { name: 'Open validator Northstar' })).toBeVisible()
    // A narrow window keeps rank, name, share and health; the other columns are on the validator's page.
    await expect(win.getByRole('columnheader')).toHaveText(['Rank', 'Validator', 'Share', 'Health'])
    const active = await fit(page)
    expect(active.spill).toBeLessThanOrEqual(1)
    expect(active).toMatchObject({ table: true, controls: true })
    await win.getByRole('group', { name: 'Validator lists' }).getByRole('button', { name: 'Candidates' }).click()
    await expect(win.getByText('No registered operator is outside the consensus set.')).toBeVisible()
    const candidates = await fit(page)
    expect(candidates.spill).toBeLessThanOrEqual(1)
    expect(candidates.controls).toBe(true)
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

test('The Validators sheet fits a 320 px phone viewport', async ({ page }) => {
    await fixture(page, 320)
    await page.goto(`${OS_ON}/os/validators`)
    await expect(page.getByRole('group', { name: 'Validator lists' }).getByRole('button', { name: 'Candidates' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open validator Northstar' })).toBeVisible()
    await expect(page.getByRole('columnheader')).toHaveText(['Rank', 'Validator', 'Share', 'Health'])
    const sheet = await fit(page)
    expect(sheet.spill).toBeLessThanOrEqual(1)
    expect(sheet).toMatchObject({ table: true, controls: true })
})

test('Roster search explains zero matches and restores context after a profile visit', async ({ page }) => {
    await fixture(page, 1280)
    await page.goto(`${OS_ON}/os/validators`)
    const win = page.getByRole('region', { name: 'Validators', exact: true })
    const search = win.getByRole('searchbox', { name: 'Search validators' })
    const northstar = win.getByRole('button', { name: 'Open validator Northstar' })
    await expect(search).toBeVisible()
    await search.fill('__no_validator_matches__')
    await expect(win.getByText('No validator matches this search and filter.')).toBeVisible()
    await win.getByRole('button', { name: 'Clear filters' }).click()
    await expect(search).toHaveValue('')
    await search.fill('Northstar')
    await expect(page).toHaveURL(/q=Northstar/)
    await northstar.click()
    await expect(win.getByTestId('validator-profile-page')).toBeVisible()
    // Opening a validator is a history entry: Back returns to the list as it was searched.
    await page.goBack()
    await expect(search).toHaveValue('Northstar')
    await expect(northstar).toBeVisible()
    await page.goForward()
    await expect(win.getByTestId('validator-profile-page')).toBeVisible()
    const back = win.getByRole('link', { name: '← Validators' })
    await expect(back).toHaveAttribute('href', '/os/validators?q=Northstar')
    await back.click()
    await expect(search).toHaveValue('Northstar')
    await expect(northstar).toBeVisible()
    // The classic page's link is a history entry with its query: Back returns to the
    // validator, Forward to the list as it was searched.
    await page.goBack()
    await expect(win.getByTestId('validator-profile-page')).toBeVisible()
    await page.goForward()
    await expect(search).toHaveValue('Northstar')
})

test('Profile return link restores the Candidates list in OS', async ({ page }) => {
    await fixture(page, 1280)
    await page.goto(`${OS_ON}/os/validators/g1mockval0000000000000000000000000000001?from=tab%3Dcandidates`)
    const win = page.getByRole('region', { name: 'Validators', exact: true })
    const back = win.getByRole('link', { name: '← Validators' })
    await expect(back).toHaveAttribute('href', '/os/validators?tab=candidates')
    await back.click()
    await expect(win.getByRole('group', { name: 'Validator lists' }).getByRole('button', { name: 'Candidates' })).toHaveAttribute('aria-pressed', 'true')
})
