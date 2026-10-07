import { expect, test, type Page } from '@playwright/test'
import { OS_FLAGS_ON, OS_ON } from '../../playwright.os.config'
import { fulfillGovernance } from '../helpers/proGovernanceFixture'

// Day 7 smoke: each of the 8 core apps (D8) opens in its window, desktop and
// phone, without hitting an error boundary. Backend and indexer calls are
// refused: this checks that every window survives an offline backend.

const CORE = [
    ['daos', 'DAOs'], ['wallet', 'Wallet'], ['multisig', 'Multisig'], ['feed', 'Feed'],
    ['store', 'App Store'], ['arcade', 'Arcade'], ['validators', 'Validators'], ['settings', 'Settings'],
] as const

for (const [width, label] of [[1280, 'desktop'], [375, 'phone']] as const) {
    test.describe(`Memba OS smoke · ${label}`, () => {
        test.beforeEach(async ({ page }) => {
            await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (r) => r.abort())
            await fulfillGovernance(page)
            await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
            await page.setViewportSize({ width, height: 800 })
        })

        for (const [slug, name] of CORE) {
            test(`${name} opens`, async ({ page }) => {
                const errors: string[] = []
                page.on('pageerror', (e) => errors.push(e.message))
                await page.goto(`${OS_ON}/os/${slug}`)
                const win = page.getByRole('region', { name, exact: true })
                await expect(win).toBeVisible()
                // Something rendered inside, and no error boundary took over.
                await expect.poll(async () => (await win.innerText()).trim().length).toBeGreaterThan(name.length + 5)
                await expect(page.getByText(/Page could not load|Something went wrong/)).toHaveCount(0)
                expect(errors).toEqual([])
            })
        }
    })
}

test.describe('Memba OS window failure', () => {
    test('a window whose code cannot load fails inside itself; the other windows keep working', async ({ page }) => {
        await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (r) => r.abort())
        await fulfillGovernance(page)
        await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
        await page.setViewportSize({ width: 1280, height: 800 })
        // The Multisig app's module never arrives (a stale chunk after a deploy, or the network).
        // The once-per-session automatic reload runs first; the second failure stays in the window.
        await page.route(/\/os\/multisig\/MultisigWindows/, (r) => r.abort())
        await page.goto(`${OS_ON}/os/multisig?w=app.daos`)
        const multisig = page.getByRole('region', { name: 'Multisig', exact: true })
        await expect(multisig.getByText('This window could not load')).toBeVisible()
        await expect(multisig.getByRole('button', { name: 'Reload Memba' })).toBeVisible()
        await expect(page.getByText(/Page could not load|Something went wrong/)).toHaveCount(0)
        const daos = page.getByRole('region', { name: 'DAOs', exact: true })
        await expect(daos).toBeVisible()
        await expect(daos.getByText('GovDAO').first()).toBeVisible()
        await multisig.getByRole('button', { name: 'Close window' }).click()
        await expect(multisig).toHaveCount(0)
        await expect(daos).toBeVisible()
    })
})

test.describe('Memba OS · the optional account', () => {
    const SIGN_IN = /clerk\.example\.test|challenges\.cloudflare\.com/
    /** Every attempt to reach Clerk or its bot check: a request, or a script the CSP refused before any request. */
    function watchSignIn(page: Page): string[] {
        const seen: string[] = []
        page.on('request', (r) => { if (SIGN_IN.test(new URL(r.url()).hostname)) seen.push(r.url()) })
        page.on('console', (m) => { if (SIGN_IN.test(m.text())) seen.push(m.text()) })
        return seen
    }
    test.beforeEach(async ({ page }) => {
        await page.route(/memba\.v1\.|gnolove|plausible\.io|sentry\.|clerk[.-]/, (r) => r.abort())
        await fulfillGovernance(page)
        await page.addInitScript(() => localStorage.setItem('memba_os_skip_intro', '1'))
        await page.setViewportSize({ width: 1280, height: 800 })
    })

    // On the build that has a Clerk key (an unreachable test host): without one, nothing could load anyway.
    test('a guest who never signs in makes no attempt to reach Clerk or its bot check, whatever they open', async ({ page }) => {
        const seen = watchSignIn(page)
        for (const [slug, name] of [...CORE, ['profile', 'Profile']] as const) {
            await page.goto(`${OS_FLAGS_ON}/os/${slug}`)
            await expect(page.getByRole('region', { name, exact: true })).toBeVisible()
        }
        expect(seen).toEqual([])
    })

    test('the same watch sees Clerk load once the guest asks to sign in (the control for the case above)', async ({ page }) => {
        const seen = watchSignIn(page)
        await page.goto(`${OS_FLAGS_ON}/os/validators/alerts`)
        await page.getByRole('button', { name: 'Sign in to configure alerts' }).click()
        await expect.poll(() => seen.length).toBeGreaterThan(0)
    })
})
