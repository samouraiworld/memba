import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { stubNetwork } from './helpers/stubNetwork'
import { suppressReleaseAnnouncement } from './helpers/releaseAnnouncement'
import { fulfillGovernance } from './helpers/proGovernanceFixture'
import { waitForRouteSettled } from './helpers/routeSettled'

// Every family, including guarded, missing-resource and specialist routes. All remote traffic is stubbed.
export const designRoutes = [
    '', 'dashboard', 'dao', 'dao/create', 'dao/gno.land/r/gov/dao', 'dao/gno.land/r/gov/dao/members',
    'dao/gno.land/r/gov/dao/proposal/4', 'dao/gno.land/r/gov/dao/propose', 'dao/gno.land/r/gov/dao/treasury',
    'dao/gno.land/r/gov/dao/treasury/propose', 'dao/gno.land/r/gov/dao/channels', 'dao/gno.land/r/gov/dao/plugin/board',
    'create', 'import', 'multisig', 'multisig/g1fixture', 'multisig/g1fixture/propose', 'tx/fixture',
    'tokens', 'tokens/EXAMPLE', 'create-token', 'profile', 'profile/g1fixture', 'settings', 'organizations',
    'directory', 'explorer/gno.land/r/gov/dao', 'apps', 'apps/submit', 'apps/review', 'apps/my-submissions', 'apps/fixture',
    'validators', 'validators/hacker', 'validators/g1fixture', 'validators/valoper/g1fixture', 'alerts',
    'nft', 'nft/create', 'nft/create/advanced', 'nft/collection/fixture/demo', 'nft/token/fixture/demo/1',
    'nft/creator', 'nft/creator/g1fixture', 'nft/studio', 'nft/studio/fixture/demo', 'nft/legacy',
    'services', 'extensions', 'marketplace', 'marketplace/services', 'marketplace/agents', 'marketplace-v2-preview',
    'gnolove', 'gnolove/report', 'gnolove/notable-prs', 'gnolove/analytics', 'gnolove/contributor/fixture',
    'gnolove/teams', 'gnolove/teams/fixture', 'gnolove/reports', 'gnolove/milestone',
    'quests', 'quests/fixture', 'quest-admin', 'leaderboard', 'points', 'candidature',
    'feed', 'feed/post/1', 'feed/user/g1fixture', 'feed/mod', 'feed/transparency',
    'feedback', 'changelogs', 'blog', 'blog/fixture', 'github/callback', 'u/fixture', 'missing-page',
    'game', 'game/space-invaders', 'game/barricade',
]
test.beforeEach(async ({ page }) => {
    await stubNetwork(page)
    await fulfillGovernance(page)
    await suppressReleaseAnnouncement(page)
})
const routesToReview = process.env.DESIGN_REVIEW_FEATURES === 'true' ? designRoutes.filter(path => /^(apps|nft|feed|marketplace|services|game)/.test(path)) : designRoutes
for (const theme of ['dark', 'light'] as const) {
    for (const width of [390, 1600]) {
        for (let offset = 0; offset < routesToReview.length; offset += 8) {
            const routes = routesToReview.slice(offset, offset + 8)
            test(`route coverage ${theme} ${width}px group ${offset / 8 + 1}`, async ({ page }, info) => {
                test.setTimeout(180_000)
                await page.setViewportSize({ width, height: 1000 })
                await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
                for (const route of routes) {
                    await test.step(route || 'Home', async () => {
                        const errors: string[] = []
                        const onError = (error: Error) => errors.push(error.message)
                        page.on('pageerror', onError)
                        await page.goto(`/pearl/${route}`)
                        await expect(page.locator('.k-pro-app')).toBeVisible()
                        await expect(page.locator('#main-content')).not.toHaveText('')
                        await waitForRouteSettled(page) // route chunk rendered and deterministic reads applied
                        expect.soft(errors, route).toEqual([])
                        const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
                            nodes: [...document.querySelectorAll('main *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 2 || r.left < -2) && getComputedStyle(el).position !== 'fixed' }).slice(0, 8).map(el => el.className) }))
                        expect.soft(overflow.scroll, `${route}: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(width + 2)
                        expect.soft(await page.locator('main').innerText(), route).not.toContain('Something went wrong')
                        if (!['game', 'game/barricade', 'game/space-invaders'].includes(route)) {
                            const a11y = await new AxeBuilder({ page }).include('#main-content').withRules(['color-contrast','button-name','link-name','label','nested-interactive']).analyze()
                            expect.soft(a11y.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), route).toEqual([])
                        }
                        await page.screenshot({ path: info.outputPath(`${route.replaceAll('/', '-') || 'home'}.png`), fullPage: false })
                        page.off('pageerror', onError)
                    })
                }
            })
        }
    }
}
test('DAO search and theme interaction', async ({ page }) => {
    await page.goto('/pearl/dao')
    await page.getByRole('searchbox', { name: 'Your DAOs' }).fill('no such community')
    await expect(page.getByText(/No DAOs match/)).toBeVisible()
    await page.getByRole('button', { name: 'Clear search' }).click()
    // The DAO card opens through its name link (no card-level click handler).
    const govdaoLink = page.getByRole('link', { name: 'GovDAO', exact: true }).and(page.locator('.k-dao-card__link'))
    await expect(govdaoLink).toBeVisible()
    await govdaoLink.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.gov-proposal-link')).toHaveCount(4)
})

// Protected routes render using a synthetic session and an inert wallet provider.
// The fixture is never imported by src/ and cannot authorize any real RPC.
import { accountReviewFixture, REVIEW_ADDRESS } from './helpers/proAccountFixture'
for (const theme of ['dark', 'light'] as const) {
    test(`protected workflow ${theme} interaction`, async ({ page }, info) => {
        test.setTimeout(180_000)
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        await accountReviewFixture(page)
        for (const path of ['dashboard', 'multisig', 'create', 'import', `multisig/${REVIEW_ADDRESS}`, `multisig/${REVIEW_ADDRESS}/propose`, 'tx/7', 'create-token', 'dao/create', 'settings', 'profile', 'alerts', 'organizations']) {
            await page.goto(`/pearl/${path}`)
            await expect(page.locator('.k-pro-app')).toBeVisible()
            await expect(page.locator('#main-content')).not.toHaveText('')
            await waitForRouteSettled(page, { quietMs: 500 })
            if (path === 'multisig') await expect(page.getByRole('button', { name: 'Community operations', exact: true })).toBeVisible()
            if (path === 'tx/7') await expect(page.locator('#main-content')).toContainText('Community operations — design fixture')
            expect.soft(await page.locator('main').innerText(), path).not.toContain('Something went wrong')
            expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), path).toBe(true)
            const a11y = await new AxeBuilder({ page }).include('#main-content').withRules(['color-contrast','button-name','link-name','label','nested-interactive']).analyze()
            expect.soft(a11y.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), path).toEqual([])
            await page.evaluate(() => { const label = document.createElement('p'); label.textContent = 'Design review · synthetic account · wallet actions disabled'; document.querySelector('main')!.prepend(label) })
            await page.screenshot({ path: info.outputPath(`${path.replaceAll('/', '-')}.png`), fullPage: true })
        }
    })
}

// Validate populated data under the complete system as well as the standalone pilot.
import { fulfillProValidatorRoster } from './helpers/proValidatorsFixture'
for (const theme of ['dark', 'light'] as const) {
    for (const width of [390, 1600]) {
        test(`populated validator roster ${theme} ${width}px`, async ({ page }, info) => {
            await fulfillProValidatorRoster(page, 'mixed')
            await page.setViewportSize({ width, height: 1000 })
            await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
            await page.goto('/pearl/validators')
            await expect(page.locator('.k-pro-app')).toBeVisible()
            if (width >= 1280) {
                await expect(page.locator('.val-table tbody tr')).toHaveCount(4)
                expect(await page.locator('.val-table-wrap').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
            } else {
                await expect(page.getByTestId('validator-card-1')).toBeVisible()
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true)
            const a11y = await new AxeBuilder({ page }).include('#main-content').withRules(['color-contrast', 'button-name', 'link-name', 'label', 'nested-interactive']).analyze()
            expect(a11y.violations).toEqual([])
            await page.screenshot({ path: info.outputPath('validators-populated.png'), fullPage: true })
        })
    }
}

import { stubFeedBackend, BUSY_THREAD_ID } from './helpers/feedFixture'
if (process.env.DESIGN_REVIEW_FEATURES === 'true') {
    for (const theme of ['dark', 'light'] as const) {
        for (const width of [390, 1600]) {
            test(`populated community feed ${theme} ${width}px`, async ({ page }, info) => {
                await stubFeedBackend(page)
                await page.setViewportSize({ width, height: 1000 })
                await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
                await page.goto('/pearl/feed')
                await expect(page.getByText('Post number 25 on the Memba feed — gno-native, on-chain, no custodian.')).toBeVisible()
                for (const name of ['timeline', 'thread']) {
                    if (name === 'thread') {
                        await page.goto(`/pearl/feed/post/${BUSY_THREAD_ID}`)
                        await expect(page.getByText('A very active thread about gno-native governance.')).toBeVisible()
                    }
                    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true)
                    const a11y = await new AxeBuilder({ page }).include('#main-content').withRules(['color-contrast', 'button-name', 'link-name', 'label', 'nested-interactive']).analyze()
                    expect(a11y.violations).toEqual([])
                    await page.screenshot({ path: info.outputPath(`feed-${name}.png`), fullPage: false })
                }
            })
        }
    }
}

if (process.env.DESIGN_REVIEW_FEATURES !== 'true') {
    for (const theme of ['dark', 'light'] as const) {
        for (const width of [390, 1600]) {
            test(`discovery previews ${theme} ${width}px`, async ({ page }, info) => {
                await page.setViewportSize({ width, height: 1000 })
                await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
                for (const route of ['marketplace', 'points', 'apps']) {
                    await page.goto(`/mainnet/${route}`)
                    await expect(page.locator('.k-pro-app')).toBeVisible()
                    if (route === 'apps') {
                        for (const name of ['Adena', 'GnoSwap', 'Boards', 'Akkadia', 'GnoScan', 'Gno Playground']) {
                            await expect(page.getByRole('link', { name: `Visit ${name} (opens in a new tab)` })).toBeVisible()
                        }
                        await expect(page.getByText('Builder preview', { exact: true })).toBeVisible()
                    } else {
                        const preview = page.getByRole('figure', { name: /design preview/ })
                        await expect(preview.getByText('Illustrative · not live')).toBeVisible()
                        await expect(preview.locator('a, button, input, select, textarea, [tabindex]')).toHaveCount(0)
                        await expect(page.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/mainnet/')
                    }
                    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true)
                    const a11y = await new AxeBuilder({ page }).include('#main-content').withRules(['color-contrast', 'button-name', 'link-name', 'label', 'nested-interactive']).analyze()
                    expect(a11y.violations).toEqual([])
                    await page.screenshot({ path: info.outputPath(`discovery-${route}.png`), fullPage: true })
                }
                if (width === 1600) {
                    await page.locator('summary[aria-label="Community"]').click()
                    await expect(page.getByRole('link', { name: 'Dev Report', exact: true })).toHaveAttribute('href', '/mainnet/gnolove')
                }
            })
        }
    }
}

for (const network of ['mainnet', 'pearl'] as const) {
    for (const width of [390, 1440]) {
        test(`Home network capability ${network} ${width}`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 })
            await page.goto(`/${network}`)
            await expect(page.getByTestId('value-card-vote')).toContainText('Explore DAOs')
            const tokenCard = page.getByTestId('value-card-launch')
            if (network === 'mainnet') {
                await expect(tokenCard).toContainText('not available on this network')
                await expect(page.getByRole('link', { name: 'MembaDAO', exact: true })).toHaveCount(0)
                await tokenCard.click()
                await expect(page.getByRole('heading', { name: 'Not available on this network' })).toBeVisible()
                await expect(page.getByRole('button', { name: /Create a Token/ })).toHaveCount(0)
            } else {
                await expect(tokenCard).toContainText('Launch a token')
                await tokenCard.click()
                await expect(page.getByRole('button', { name: /Create a Token/ }).first()).toBeVisible()
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 2)
        })
    }
}

// C1: selected-network namespace evidence and exact search-result destinations.
import { fulfillOnchainReads, mockAppChainStatus } from './helpers/onchain'
for (const network of ['mainnet', 'pearl']) {
    test(`directory provenance and navigation interaction ${network}`, async ({ page }) => {
        const chain = network === 'mainnet' ? 'gnoland-1' : 'pearl-1'
        await fulfillOnchainReads(page, ({ method, path, arg }) => {
            if (method === 'status') return mockAppChainStatus(chain)
            if (path === 'vm/qrender') return `# Selected ${arg}`
            if (path === 'vm/qfile') return arg.endsWith('/demo.gno') ? 'package boards\n// Source fixture' : 'demo.gno'
            if (path === 'vm/qfuncs') return '[]'
            return null
        })
        await page.route(/https:\/\/(gno\.land|[^/]+\.gno\.land)\/[rp]\/samcrew$/, route => route.fulfill({
            contentType: 'text/html', body: `<meta name="gnoconnect:chainid" content="${chain}"><a href="/p/samcrew/fixture">fixture</a>`,
        }))
        await page.goto(`/${network}/directory`)
        if (network === 'mainnet') {
            // Existing CSP intentionally excludes bare gno.land. Exercise the real
            // browser fallback; do not bypass security just to fulfill a fixture.
            await expect(page.getByRole('button', { name: 'Retry discovery' })).toBeVisible()
            await expect(page.getByTestId('package-card')).toHaveCount(0)
        } else {
            await expect(page.getByText('Namespace listings checked.', { exact: false })).toBeVisible()
            await expect(page.getByTestId('package-card').filter({ hasText: 'fixture' })).toContainText('Namespace listing')
        }
        await expect(page.locator('main')).not.toContainText('Deployed at block')
        await page.getByTestId('global-search').fill('Boards')
        const selectedPath = network === 'mainnet' ? 'r/gnoland/boards2/v0' : 'r/gnoland/boards2/v1'
        await page.locator('.dir-cross-item').filter({ hasText: `gno.land/${selectedPath}` }).click()
        await expect(page).toHaveURL(new RegExp(`/${network}/directory\\?`))
        expect(new URL(page.url()).searchParams.get('realm')).toBe(selectedPath)
        expect(new URL(page.url()).searchParams.get('q')).toBe('Boards')
        const explorer = page.getByTestId('explorer-root')
        if (new URL(page.url()).searchParams.get('tab') === 'explorer') await expect(explorer.locator('.realmview__path')).toHaveText(`gno.land/${selectedPath}`)
        else await expect(page.getByRole('dialog')).toContainText(`gno.land/${selectedPath}`)
        await page.goBack()
        await expect(page.getByTestId('global-search')).toHaveValue('Boards')
        expect(new URL(page.url()).searchParams.has('realm')).toBe(false)
        if (network === 'mainnet') return // no invented mainnet package
        await page.getByTestId('global-search').fill('fixture')
        await page.locator('.dir-cross-item').filter({ hasText: 'gno.land/p/samcrew/fixture' }).click()
        if (new URL(page.url()).searchParams.get('tab') === 'explorer') {
            await expect(explorer.getByRole('tab', { name: 'Source' })).toHaveAttribute('aria-selected', 'true')
            await expect(explorer.getByRole('tab', { name: 'Render' })).toHaveCount(0)
        } else {
            await expect(page.getByRole('dialog').getByRole('button', { name: 'Render', exact: true })).toHaveCount(0)
        }
    })
}

for (const network of ['mainnet', 'pearl']) {
    test(`ecosystem discovery interaction ${network}`, async ({ page }) => {
        await page.goto(`/${network}/apps?availability=mainnet`)
        await expect(page.getByRole('status').filter({ hasText: 'projects found' })).toHaveText('3 projects found')
        await page.getByRole('searchbox', { name: 'Search projects' }).fill('boards2/v0')
        await expect(page.getByRole('link', { name: 'Boards source (opens in a new tab)' })).toHaveAttribute('href', 'https://gno.land/r/gnoland/boards2/v0$source')
        await page.reload()
        await expect(page.getByRole('searchbox', { name: 'Search projects' })).toHaveValue('boards2/v0')
        await page.getByRole('combobox', { name: 'Availability', exact: true }).selectOption('unknown')
        await expect(page.getByText('No projects match these filters.', { exact: false })).toBeVisible()
        await page.goBack()
        await expect(page.getByRole('combobox', { name: 'Availability', exact: true })).toHaveValue('mainnet')
        await page.getByRole('button', { name: 'Reset filters' }).click()
        await expect(page.getByRole('link', { name: 'Visit mygnoscan (opens in a new tab)' })).toHaveAttribute('href', 'https://mygnoscan.moul.p2p.team/storage?network=mainnet')
        await expect(page.getByRole('button', { name: /connect wallet/i })).toHaveCount(0)
        if (network === 'mainnet') {
            await expect(page.getByTestId('appstore-root')).toHaveCount(0)
            await expect(page.getByRole('link', { name: 'Submit your app', exact: true })).toHaveCount(0)
            await page.goto('/mainnet/apps/submit')
            await expect(page.getByRole('link', { name: 'Browse ecosystem projects' })).toBeVisible()
        }
    })
}
