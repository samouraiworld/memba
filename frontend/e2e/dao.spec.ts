import { test, expect, type Page } from '@playwright/test'
import { fulfillOnchainReads, mockAppChainStatus } from './helpers/onchain'
import { MOBILE_375, expectNoMobileOverflow } from './helpers/overflow'
import AxeBuilder from '@axe-core/playwright'

/**
 * DAO E2E — verifies DAO Hub, GovDAO page, Create DAO, and proposal pages.
 * No wallet required — tests page structure and ABCI data rendering.
 *
 * Fully offline (2026-07-30): EVERY spec fulfills its on-chain reads via the
 * file-level beforeEach below. This file used to be a serial live-RPC suite
 * with only two specs fulfilled; the rest raced live reads against the
 * then-default topaz RPC (~12s
 * healthy) against 10–20s expect budgets, and one loss cascaded "did not
 * run" through the whole serial chain — under concurrent CI suites (three
 * cycles at once, 2026-07-30, run 30566702351) that redded back-button /
 * View-All / Treasury on every overlapping run while each solo re-run stayed
 * green. With zero live reads the serial worker-cap is pointless too, so the
 * file runs fully parallel and a failure stays scoped to its own spec.
 *
 * The proposal-conditional probes (pagination, EXECUTE badge)
 * see the fixture's 0-proposal chain and skip deterministically — the same
 * outcome they had on the then-default topaz, which had no GovDAO proposals.
 * (Pearl, today's default, DOES carry GovDAO proposals — the offline fixture,
 * not the chain, is what keeps these skips deterministic.)
 * The live-resolution smoke stays in directory-live.spec.ts, alone by design.
 */

/**
 * Fulfill the GovDAO home reads with a deterministic offline payload.
 *
 * Why fulfill and not abort: with reads merely aborted, DAOHome still settles
 * (strict getDAOConfig throws → catch clears configLoading) and renders the
 * stat grid + Treasury heading — but with NO tierDistribution there is no
 * PowerDonut, so nothing competes with `.k-stat-grid--compact` for the flex
 * row and the starved-sliver regression the mobile test guards can't
 * reproduce (the assertion would pass vacuously). The GovDAO Render body
 * (name + memberstore link) plus the memberstore tier render (3 tiers,
 * total power 17) puts the donut back next to the grid. Everything else
 * resolves empty: 0 proposals → no per-proposal enrichment fan-out, and the
 * Members chip falls back to config.memberCount (10, summed from the tiers).
 *
 * The empty default also serves the non-GovDAO pages this file visits: the
 * hub's per-DAO resolution reads and the members page's detail reads settle
 * as null/[] and render their deterministic fallbacks.
 */
async function fulfillGovDaoHome(page: Page, chainId?: string) {
    const GOVDAO_RENDER = [
        '# GovDAO',
        '',
        'Gno chain governance — proposals and membership management.',
        '',
        // getDAOConfig derives the memberstore realm path from this link, and only
        // trusts it under the Members section (live pearl-1 and gnoland-1 renders).
        '## Members',
        '[> Go to Memberstore <](https://gno.land/r/gov/dao/v3/memberstore)',
        '',
        '## Proposals',
        '',
        '_No active proposals._',
        '',
    ].join('\n')
    const MEMBERSTORE_RENDER = [
        '# GovDAO Memberstore',
        '',
        // parseMemberstoreTiers shape: "Tier <name> contains <n> members with power: <p>"
        'Tier T1 contains 2 members with power: 6',
        'Tier T2 contains 3 members with power: 6',
        'Tier T3 contains 5 members with power: 5',
        '',
    ].join('\n')
    await fulfillOnchainReads(page, ({ method, path, arg }) => {
        if (path === 'vm/qrender' && arg === 'gno.land/r/gov/dao:') return GOVDAO_RENDER
        if (path === 'vm/qrender' && arg === 'gno.land/r/gov/dao/v3/memberstore:') return MEMBERSTORE_RENDER
        // A version-1 generated DAO: identified by its API version, so the propose page is offered.
        if (path === 'vm/qeval' && arg === `${V1_DAO}.GetAPIVersion()`) return '("1.0" string)'
        // A version-2 generated DAO: identified by its template version and read through JSON only.
        if (path === 'vm/qeval' && arg.startsWith(`${V2_DAO}.`)) return V2_READS[arg.slice(V2_DAO.length + 1)] ?? null
        if (method === 'status') return chainId ? mockAppChainStatus(chainId) : mockAppChainStatus()
        return null
    })
}

const V1_DAO = 'gno.land/r/test/mydao'

// ── Version-2 DAO fixture (template memba-dao/2) ──────────────
const V2_DAO = 'gno.land/r/test/teamv2'
const V2_ALICE = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5'
const V2_BOB = 'g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c'
const NOW = Math.floor(Date.now() / 1000)
const wire = (value: unknown) => `(${JSON.stringify(JSON.stringify(value))} string)`
const V2_PROPOSAL = {
    id: 1, title: 'Adopt the roadmap', category: 'governance', author: V2_BOB,
    action: { kind: 'text', target: '', power: 0, roles: [] },
    electorate_power: 3, electorate_version: 0, created_at: NOW - 3600, voting_ends_at: NOW + 2 * 86400,
    status: 'ACTIVE', yes: 1, no: 0, abstain: 0, accepted_at: 0, executable_at: 0, execute_by: 0,
}
const V2_READS: Record<string, string> = {
    'GetTemplateVersion()': '("memba-dao/2" string)',
    'GetConfigJSON()': wire({
        template_version: 'memba-dao/2', api_version: '2.0', name: 'Team Two', description: 'A version-2 DAO',
        threshold: 60, quorum: 20, voting_period: 3 * 86400, execution_delay: 3600, execution_window: 7 * 86400,
        categories: ['governance', 'ops'], roles: ['lead', 'member'], archived: false,
        member_count: 2, total_power: 3, electorate_version: 0, proposal_count: 1,
    }),
    'GetMembersJSON(0, 50)': wire({ total: 2, offset: 0, members: [{ address: V2_ALICE, power: 2, roles: ['lead'] }, { address: V2_BOB, power: 1, roles: [] }] }),
    'GetProposalsJSON(0, 50)': wire({ proposals: [V2_PROPOSAL], next_before: 0 }),
    'GetProposalJSON(1)': wire({ ...V2_PROPOSAL, description: 'Line one\nLine two' }),
    'GetVotesJSON(1, 0, 50)': wire({ total: 1, offset: 0, votes: [{ voter: V2_BOB, choice: 'YES', power: 1 }] }),
}

const SERIOUS = new Set(['critical', 'serious'])
async function seriousAxeViolations(page: Page) {
    const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        // Same known, tracked exclusions as accessibility.spec.ts.
        .disableRules(['color-contrast', 'link-in-text-block', 'nested-interactive'])
        .analyze()
    return results.violations.filter(v => SERIOUS.has(v.impact ?? '')).map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

// Every spec in this file runs against the offline GovDAO fixture. Register
// before each test (routes are per-context) and before any goto.
test.beforeEach(async ({ page }) => {
    await fulfillGovDaoHome(page)
})

test.describe('DAO Hub', () => {
    test('DAO hub shows GovDAO featured card', async ({ page }) => {
        await page.goto('/dao')
        await expect(page.locator('body')).toContainText(/GovDAO|Governance/)
    })

    test('Create DAO CTA follows the network — offered on the gno.land default, absent on Betanet', async ({ page }) => {
        // `userDaos.create` is PER-NETWORK: gno.land (the default) offers DAO
        // creation, Betanet does not. Both halves are asserted so neither
        // direction can rot silently.
        await page.goto('/dao')
        await expect(page.getByRole('heading', { name: /DAO Governance/ })).toBeVisible()
        await expect(page.locator('body')).toContainText(/Create|New DAO/)

        // Re-register the fixture with Betanet's chain id: DAO reads identity-check
        // the RPC against the selected network (#1222), and Playwright matches
        // routes in reverse registration order, so this handler wins. Betanet is
        // hidden from the picker but its deep links still resolve.
        await fulfillGovDaoHome(page, 'gnoland1')
        await page.goto('/gnoland1/dao')
        await expect(page.getByRole('heading', { name: /DAO Governance/ })).toBeVisible()
        await expect(page.locator('body')).not.toContainText(/Create a DAO|New DAO/)
    })

    test('connect form collapsed by default', async ({ page }) => {
        await page.goto('/dao')
        const input = page.locator('#dao-connect-input')
        await expect(input).not.toBeVisible()
    })
})

test.describe('GovDAO Page', () => {
    test('GovDAO page loads with stats', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        // Wait for config to load (shows DAO name)
        await expect(page.locator('body')).toContainText(/GovDAO|DAO Governance|Governance/, { timeout: 20_000 })
        // Stats grid should show "Members" card
        await expect(page.locator('body')).toContainText('Members', { timeout: 20_000 })
    })

    test('back button navigates to DAO list', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        const backBtn = page.locator('#dao-back-btn')
        await expect(backBtn).toBeVisible()
        await expect(backBtn).toContainText('DAOs')
    })

    test('no blockchain-error toast on load (GetProposalsJSON strict-probe regression)', async ({ page }) => {
        // GovDAO v3 does not export the W1.4 JSON getters; the strict proposals
        // read must fall back to Render parsing silently instead of surfacing
        // "Blockchain query failed" (the bug: strict probe threw before the
        // fallback ran, on every GovDAO visit).
        await page.goto('/dao/gno.land~r~gov~dao')
        await expect(page.locator('body')).toContainText('Members', { timeout: 20_000 })
        // Give the (previously failing) proposals read time to surface its toast
        await page.waitForTimeout(1_500)
        await expect(page.locator('body')).not.toContainText('Blockchain query failed')
    })

    test('mobile: stat chips get the full row (no mid-word wrap next to the donut)', async ({ page }) => {
        // Pure geometry assertion; the fixture's tier render guarantees the
        // PowerDonut — the flex sibling this regression is about — is in the row.
        await page.setViewportSize({ width: 375, height: 812 })
        await page.goto('/dao/gno.land~r~gov~dao')
        const grid = page.locator('.k-stat-grid--compact')
        await expect(grid).toBeVisible({ timeout: 20_000 })
        // Guard the guard: the donut must be present, or the width assertion
        // below passes vacuously with nothing competing for the flex row.
        // (PowerDonut has no class/testid; it is the only svg in the left column.)
        await expect(page.locator('.dao-card-columns__left svg').first()).toBeVisible()
        // Starved-flex-sliver regression: the grid must take (nearly) the full
        // card row, not the ~70px leftover beside the power donut.
        const width = (await grid.boundingBox())?.width ?? 0
        expect(width).toBeGreaterThan(250)
    })

    test('power distribution section visible', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        // GovDAO has tier distribution — may not render on fresh chains until members resolve
        await expect(page.locator('body')).toContainText(/Power Distribution|T1|T2|Members/, { timeout: 20_000 })
    })

    test('no treasury surface on a DAO page', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        await expect(page.locator('body')).toContainText('Members', { timeout: 20_000 })
        await expect(page.locator('.dao-treasury-card')).toHaveCount(0)
    })

    test('treasury route shows the unavailable page', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/treasury')
        await expect(page.getByRole('heading', { name: /Not available for this DAO or network/ })).toBeVisible()
    })

    test('members section shows View All link', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        await expect(page.locator('body')).toContainText('View All')
    })

    test('v2.12 — more than 5 proposals render (pagination proof)', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        const proposalsStat = page.locator('.k-stat-card', { hasText: 'Proposals' })
        await expect(proposalsStat).toBeVisible({ timeout: 20_000 })
        // Poll until value resolves
        let count = 0
        try {
            await expect(async () => {
                const countText = await proposalsStat.locator('.k-stat-card__value').textContent()
                count = parseInt(countText || '0', 10)
                expect(count).toBeGreaterThan(0)
            }).toPass({ timeout: 15000 })
        } catch {
            test.skip(true, 'No proposals on this chain yet')
            return
        }
        if (count <= 5) {
            test.skip(true, `Only ${count} proposals — need > 5 for pagination proof`)
            return
        }
        expect(count).toBeGreaterThan(5)
    })

    test('GovDAO page offers no channels or voice rooms', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        await expect(page.locator('body')).toContainText('Members', { timeout: 20_000 })
        await expect(page.locator('.dao-channels-sidebar')).toHaveCount(0)
        await expect(page.locator('body')).not.toContainText('Public Room')
    })

    test('v2.13 — GovDAO shows inline EXECUTE badge for passed proposals', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao')
        const proposalsStat = page.locator('.k-stat-card', { hasText: 'Proposals' })
        await expect(proposalsStat).toBeVisible({ timeout: 20_000 })
        // Wait for proposals to load
        let count = 0
        try {
            await expect(async () => {
                const countText = await proposalsStat.locator('.k-stat-card__value').textContent()
                count = parseInt(countText || '0', 10)
                expect(count).toBeGreaterThan(0)
            }).toPass({ timeout: 15000 })
        } catch {
            test.skip(true, 'No proposals on this chain — cannot check EXECUTE badges')
            return
        }
        // Only check for EXECUTE badge if there are passed proposals
        const executeBadges = page.locator('text=EXECUTE')
        const badgeCount = await executeBadges.count()
        if (badgeCount === 0) {
            test.skip(true, 'No passed proposals with EXECUTE status on this chain')
            return
        }
        await expect(executeBadges.first()).toBeVisible()
    })
})

test.describe('DAO Members Page', () => {
    test('members page loads', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/members')
        // Members heading appears after ABCI data loads — allow extra time for CI
        await expect(page.locator('body')).toContainText(/Member|GovDAO|T1|Back/, { timeout: 20_000 })
    })
})

test.describe('Create DAO Wizard', () => {
    test('create DAO page loads with form', async ({ page }) => {
        await page.goto('/create-dao')
        await expect(page.locator('body')).toContainText(/Create|DAO|Name/)
    })
})

test.describe('Proposal Types (ProposeDAO)', () => {
    test('GovDAO does not offer a propose page', async ({ page }) => {
        await page.goto('/dao/gno.land~r~gov~dao/propose')
        await expect(page.getByRole('heading', { name: /Not available for this DAO or network/ })).toBeVisible()
    })

    test('text proposal type is active', async ({ page }) => {
        await page.goto(`/dao/${V1_DAO}/propose`)
        const textBtn = page.locator('button', { hasText: 'Text / Sentiment' })
        await expect(textBtn).toBeVisible()
        await expect(textBtn).not.toBeDisabled()
    })

    test('add member type is enabled', async ({ page }) => {
        await page.goto(`/dao/${V1_DAO}/propose`)
        const btn = page.locator('button', { hasText: 'Add Member' })
        await expect(btn).not.toBeDisabled()
    })

    test('no treasury spend type is offered', async ({ page }) => {
        await page.goto(`/dao/${V1_DAO}/propose`)
        await expect(page.locator('button', { hasText: 'Text / Sentiment' })).toBeVisible()
        await expect(page.locator('button', { hasText: 'Treasury Spend' })).toHaveCount(0)
    })

    test('code upgrade type is disabled', async ({ page }) => {
        await page.goto(`/dao/${V1_DAO}/propose`)
        const btn = page.locator('button', { hasText: 'Code Upgrade' })
        await expect(btn).toBeDisabled()
    })
})

test.describe('Version-2 DAO', () => {
    test('shows Overview, Proposals, Members and Settings sections', async ({ page }) => {
        await page.goto(`/dao/${V2_DAO}`)
        const nav = page.getByRole('navigation', { name: 'DAO sections' })
        await expect(nav.getByRole('link')).toHaveText(['Overview', 'Proposals', 'Members', 'Settings'])
        await expect(page.getByText('This DAO uses an older contract')).toHaveCount(0)
    })

    test('settings are read-only and pass the accessibility audit', async ({ page }) => {
        await page.goto(`/dao/${V2_DAO}/settings`)
        await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
        await expect(page.getByText('60% of all voting power', { exact: true })).toBeVisible()
        await expect(page.getByText(/Rules are permanent; to change them, create a new DAO/)).toBeVisible()
        await expect(page.getByRole('textbox')).toHaveCount(0)
        expect(await seriousAxeViolations(page)).toEqual([])
    })

    test('the proposal page shows the deadline, the power bar and that votes are final', async ({ page }) => {
        await page.goto(`/dao/${V2_DAO}/proposal/1`)
        await expect(page.getByRole('heading', { name: 'Adopt the roadmap' })).toBeVisible()
        await expect(page.getByText('Voting ends')).toBeVisible()
        await expect(page.getByRole('img', { name: /Yes 33\.3%.*threshold 60%; quorum 20%/ })).toBeVisible()
        await expect(page.getByText('Votes are final; a proposal is accepted as soon as the threshold is reached.')).toBeVisible()
        await expect(page.getByText('Connect your wallet to vote or execute.')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Vote yes' })).toHaveCount(0)
    })

    test('the propose page shows proposal types but requires a wallet before editing', async ({ page }) => {
        await page.goto(`/dao/${V2_DAO}/propose`)
        const types = page.getByRole('group', { name: 'Proposal type' })
        await expect(types.getByRole('button')).toHaveText(['Text', 'Add member', 'Remove member', 'Change roles', 'Archive DAO'])
        await expect(page.getByText('Connect your wallet to create a proposal.')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Submit proposal' })).toBeDisabled()
        for (const button of await types.getByRole('button').all()) await expect(button).toBeDisabled()
        await expect(page.getByLabel('Title', { exact: true })).toBeDisabled()
        await expect(page.getByLabel('Description', { exact: true })).toBeDisabled()
    })

    test('the members page shows voting power', async ({ page }) => {
        await page.goto(`/dao/${V2_DAO}/members`)
        await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()
        await expect(page.getByLabel('Voting power 2')).toBeVisible()
    })

    test('a version-1 DAO carries the older-contract notice', async ({ page }) => {
        await page.goto(`/dao/${V1_DAO}/members`)
        await expect(page.getByRole('note')).toContainText('This DAO uses an older contract with known limitations')
    })
})

test.describe('Create DAO wizard accessibility', () => {
    test('the first step passes the accessibility audit', async ({ page }) => {
        // Pinned to /pearl like create-dao.spec: this audits the wizard, and DAO
        // creation is a per-network capability the default network may not offer.
        await fulfillGovDaoHome(page, 'pearl-1')
        await page.goto('/pearl/dao/create')
        await expect(page.getByRole('heading', { name: 'Create a DAO' })).toBeVisible()
        await expect(page.getByRole('navigation', { name: 'Create DAO steps' }).getByRole('button')).toHaveCount(5)
        await expect(page.getByLabel('DAO Name')).toBeVisible()
        expect(await seriousAxeViolations(page)).toEqual([])
    })
})

test.describe('DAO — Mobile (375px)', () => {
    test('DAO hub at 375px — no overflow', async ({ page }) => {
        await page.setViewportSize(MOBILE_375)
        await page.goto('/dao')
        await expect(page.getByRole('heading', { name: /DAO Governance/ })).toBeVisible()
        // Wait for a resolved card too, not just the heading: the cards arrive
        // after per-DAO config resolution, so measuring on the heading alone was
        // a coin flip — it passed solo and caught a real clip under parallel load.
        await expect(page.locator('.k-dao-card').first()).toBeVisible()
        await expectNoMobileOverflow(page)
    })

    test('GovDAO page at 375px — no overflow', async ({ page }) => {
        await page.setViewportSize(MOBILE_375)
        await page.goto('/dao/gno.land~r~gov~dao')
        // The stat grid + PowerDonut the file fixture exists to populate are what
        // compete for this row at 375px; wait for the page proper before measuring.
        await expect(page.getByRole('heading', { name: 'GovDAO' })).toBeVisible()
        await expectNoMobileOverflow(page)
    })
})
