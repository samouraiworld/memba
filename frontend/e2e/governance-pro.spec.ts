import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { abortOnchainReads } from './helpers/onchain'
import { stubNetwork } from './helpers/stubNetwork'
import { suppressReleaseAnnouncement } from './helpers/releaseAnnouncement'
import { fulfillGovernance } from './helpers/proGovernanceFixture'
const dao = '/pearl/dao/gno.land/r/gov/dao'
test.beforeEach(async ({ page }) => {
    await stubNetwork(page)
    await fulfillGovernance(page)
    await suppressReleaseAnnouncement(page)
})
for (const theme of ['dark', 'light'] as const) {
    test(`desktop ${theme} overview and proposal reader`, async ({ page }, info) => {
        await page.setViewportSize({ width: 1600, height: 1100 })
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        await page.goto(dao)
        await expect(page.locator('.gov-proposal-link')).toHaveCount(4)
        await expect(page.locator('.gov-summary').getByText('Open for voting')).toBeVisible()
        await expect(page.locator('.gov-member-link')).toHaveCount(3)
        await expect(page.locator('.gov-summary > div').filter({ hasText: 'Open for voting' }).locator('dd')).toHaveText('1')
        await expect(page.locator('.gov-summary > div').filter({ hasText: 'Awaiting execution' }).locator('dd')).toHaveText('1')
        await expect(page.locator('.dao-overview-card')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)')
        await page.evaluate(() => { const n = document.createElement('p'); n.textContent = 'Test fixture'; document.querySelector('.dao-overview-card')!.prepend(n) })
        await page.screenshot({ path: info.outputPath(`governance-${theme}.png`), fullPage: true })
        expect((await new AxeBuilder({ page }).include('.gov-proposals').include('.dao-overview-card').include('#dao-members-section').analyze()).violations).toEqual([])
        await page.locator('.gov-proposal-link').first().click()
        await expect(page.locator('.proposal-title')).toHaveText('Fund the community education programme')
        await expect(page.getByText('4 reported')).toBeVisible()
        await expect(page.locator('.proposal-action-body')).toContainText('PublishPolicy')
        await expect(page.getByRole('button', { name: 'Vote Yes on this proposal' })).toHaveCount(0)
        await expect(page.getByText('Connect your wallet to check your voting eligibility.')).toBeVisible()
        await page.evaluate(() => { const n = document.createElement('p'); n.textContent = 'Test fixture'; document.querySelector('.proposal-container')!.prepend(n) })
        await page.screenshot({ path: info.outputPath(`proposal-${theme}.png`), fullPage: true })
        expect((await new AxeBuilder({ page }).include('.proposal-container').analyze()).violations).toEqual([])
    })
}
test('filters, search, keyboard links and history mobile', async ({ page }) => {
    await page.goto(dao)
    await expect(page.locator('.gov-proposal-link')).toHaveCount(4)
    await page.getByRole('button', { name: /Awaiting execution/ }).click()
    await expect(page.locator('.gov-proposal-link')).toHaveCount(1)
    await page.getByRole('button', { name: /History/ }).click()
    await expect(page.locator('.gov-proposal-link')).toHaveCount(2)
    await page.getByRole('searchbox', { name: 'Search proposals' }).fill('no matches')
    await expect(page.getByText('No matching proposals')).toBeVisible()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await page.getByRole('searchbox', { name: 'Search proposals' }).fill('4')
    await expect(page.locator('.gov-proposal-link')).toHaveCount(1)
    await page.locator('.gov-proposal-link').focus(); await page.keyboard.press('Enter')
    await expect(page).toHaveURL(`${dao}/proposal/4`)
    await page.getByRole('button', { name: 'Back to DAO', exact: true }).click()
    await expect(page.locator('.gov-proposal-link')).toHaveCount(4)
})
for (const width of [320, 390, 768, 1024, 1920]) {
    test(`reading layout fits ${width}px mobile`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 1000 })
        await page.goto(dao)
        await expect(page.locator('.gov-proposal-link')).toHaveCount(4)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.goto(`${dao}/proposal/4`)
        await expect(page.locator('.proposal-title')).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        expect(await page.locator('.proposal-action-body').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        if (width === 390) {
            await page.evaluate(() => { const n = document.createElement('p'); n.textContent = 'Test fixture'; document.querySelector('.proposal-container')!.prepend(n) })
            await page.screenshot({ path: info.outputPath('proposal-mobile.png'), fullPage: true })
        }
    })
}
test('empty and unavailable states have honest copy and retry mobile', async ({ page }) => {
    await fulfillGovernance(page, { empty: true, missing: true })
    await page.goto(dao)
    await expect(page.getByText('No proposals yet')).toBeVisible()
    await page.goto(`${dao}/proposal/999`)
    await expect(page.getByText('Proposal #999 is unavailable')).toBeVisible()
    await page.getByRole('button', { name: 'Retry proposal', exact: true }).click()
    await expect(page.getByText('Proposal #999 is unavailable')).toBeVisible()
})
test('signing and treasury routes retain their original presentation', async ({ page }) => {
    for (const suffix of ['/propose', '/treasury', '/members', '/channels']) {
        await page.goto(dao + suffix)
        await expect(page.locator('.k-app-layout')).toBeVisible()
        await expect(page.locator('.k-pro-governance')).toHaveCount(0)
    }
})

test('failed RPC reads do not impersonate an empty DAO mobile', async ({ page }) => {
    await abortOnchainReads(page)
    await page.goto(dao)
    await expect(page.getByRole('button', { name: 'Retry DAO data' })).toBeVisible()
    await expect(page.getByText('Could not load proposals.', { exact: true })).toBeVisible()
    await expect(page.getByText('No proposals yet', { exact: true })).toHaveCount(0)
    await expect(page.locator('.gov-summary > div').filter({ hasText: 'Total proposals' }).locator('dd')).toHaveText('—')
})

test('passed and completed proposals show the appropriate reader guidance mobile', async ({ page }) => {
    await page.goto(`${dao}/proposal/3`)
    await expect(page.getByText('Voting has passed. Execution is available to eligible DAO members.')).toBeVisible()
    await page.goto(`${dao}/proposal/2`)
    await expect(page.getByText('Voting is closed. You can review the proposal and recorded votes.')).toBeVisible()
    await expect(page.getByRole('button', { name: /Execute proposal/ })).toHaveCount(0)
})
