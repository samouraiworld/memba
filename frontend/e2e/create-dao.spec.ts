import { test, expect } from '@playwright/test'
import { MOBILE_375, expectNoMobileOverflow } from './helpers/overflow'

/**
 * Create DAO E2E — verifies the 5-step DAO creation wizard.
 * Tests wizard structure, navigation, and form validation.
 * No wallet required.
 *
 * PINNED to /mainnet. DAO creation is a per-network capability
 * (`NETWORKS[key].userDaos.create`, on for gno.land). These specs are about the
 * WIZARD, not about which networks offer it, so they name a network explicitly
 * instead of following the default. (Pinned to /pearl until its 2026-09-23
 * retirement.) The gating itself is covered by dao.spec's
 * "Create DAO CTA follows the network".
 */

test.describe('Create DAO Wizard', () => {
    test('wizard loads with step 1 (Preset)', async ({ page }) => {
        await page.goto('/mainnet/dao/create')
        await expect(page.locator('body')).toContainText(/Create|DAO/)
        // Should show preset options
        await expect(page.locator('body')).toContainText(/Basic|Team|Treasury|Enterprise/)
    })

    test('step indicator text visible', async ({ page }) => {
        await page.goto('/mainnet/dao/create')
        // Step 1 label should show "Name, Path & Preset"
        await expect(page.locator('body')).toContainText(/Name.*Path|Preset/)
    })

    test('step 1 has preset cards', async ({ page }) => {
        await page.goto('/mainnet/dao/create')
        await expect(page.locator('body')).toContainText('Basic')
        await expect(page.locator('body')).toContainText('Team')
    })

    test('create DAO at 375px — no overflow', async ({ page }) => {
        await page.setViewportSize(MOBILE_375)
        await page.goto('/mainnet/dao/create')
        // The wizard header + step rail are the widest things on this route;
        // measuring before they exist proved nothing (~304 chars vs 1089 settled).
        await expect(page.getByRole('heading', { name: /Create a DAO/ })).toBeVisible()
        await expectNoMobileOverflow(page)
    })
    test('duplicate founders are rejected before governance review', async ({ page }) => {
        await page.goto('/mainnet/dao/create')
        await page.getByPlaceholder('My DAO', { exact: true }).fill('Configuration Test DAO')
        await page.getByPlaceholder('gno.land/r/username/mydao', { exact: true }).fill('gno.land/r/test/configuration_test')
        await page.getByRole('button', { name: 'Next: Members & Roles →' }).click()
        const address = 'g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c'
        await page.getByPlaceholder('g1...', { exact: true }).first().fill(address)
        await page.getByRole('button', { name: /Add Member/ }).click()
        await page.getByPlaceholder('g1...', { exact: true }).nth(1).fill(address)
        await page.getByRole('button', { name: 'Next: Governance →' }).click()
        await expect(page.getByText('Duplicate member addresses are not allowed')).toBeVisible()
        await expect(page.getByRole('heading', { name: 'Initial Members & Roles' })).toBeVisible()
        await page.getByPlaceholder('g1...', { exact: true }).nth(1).fill('g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5')
        await page.getByRole('button', { name: 'Next: Governance →' }).click()
        await expect(page.getByText('Governance Settings', { exact: true }).first()).toBeVisible()
    })

    test('an invalid Gno package name stays on the first step', async ({ page }) => {
        await page.goto('/mainnet/dao/create')
        await page.getByPlaceholder('My DAO', { exact: true }).fill('Configuration Test DAO')
        await page.getByPlaceholder('gno.land/r/username/mydao', { exact: true }).fill('gno.land/r/test/123dao')
        await page.getByRole('button', { name: 'Next: Members & Roles →' }).click()
        await expect(page.getByText('Realm name must be a valid, non-reserved Gno package identifier')).toBeVisible()
        await expect(page.getByPlaceholder('My DAO', { exact: true })).toBeVisible()
    })

    test('a saved review draft restores its generated realm code', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('memba_dao_draft', JSON.stringify({
            name: 'Recovery DAO', description: 'Saved review', realmPath: 'gno.land/r/test/recovery',
            members: [{ address: 'g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c', power: 1, roles: ['admin'] }],
            threshold: 51, quorum: 0, availableRoles: ['admin', 'member'], proposalCategories: ['governance'],
            selectedPreset: null, step: 5, savedAt: Date.now(), enableChannels: false, channelNames: ['general'],
        })))
        await page.goto('/mainnet/dao/create')
        await page.getByRole('button', { name: 'Resume', exact: true }).click()
        await page.getByText(/View Generated Gno Code/).click()
        await expect(page.locator('code').first()).toContainText('package recovery')
        await expect(page.getByText('Review & Deploy', { exact: true })).toBeVisible()
    })

    test('a malformed saved draft does not crash the wizard', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('memba_dao_draft', JSON.stringify({ members: null, savedAt: Date.now() })))
        await page.goto('/mainnet/dao/create')
        await expect(page.getByRole('heading', { name: /Create a DAO/ })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveCount(0)
        await expect(page.getByPlaceholder('My DAO', { exact: true })).toBeVisible()
    })

})
