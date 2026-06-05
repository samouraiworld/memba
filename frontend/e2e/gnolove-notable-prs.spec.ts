import { test, expect } from '@playwright/test'

/**
 * Gnolove Notable-PRs multi-board E2E.
 *
 * The page mirrors gnolang GitHub project boards via the gnolove Go API. The
 * backend CORS allowlist only admits the prod origins, so off-prod we mock
 * /projects/boards + /projects/notable to exercise the board selector, board
 * switching (URL + heading), issue rendering, and the Hide-done column drop.
 */

const BOARDS = [
    { id: 'notable', label: 'Notable PRs', owner: 'gnolang', number: 66,
        areas: ['VM', 'Blockchain', 'Gnops', 'Gno.land', 'UX'],
        statuses: ['Todo', 'In progress', 'Done'] },
    { id: 'gnoland-dev', label: 'Gno.land development', owner: 'gnolang', number: 38,
        areas: ['Blockchain', 'VM', 'Gnops', 'UX', 'Gno.land'],
        statuses: ['Triage', 'Backlog', 'Todo', 'In Progress', 'In Review', 'Done'] },
]

const NOTABLE_ITEMS = [
    { itemID: 'n1', boardId: 'notable', itemType: 'pr', number: 101, title: 'Notable PR one',
        url: 'https://github.com/gnolang/gno/pull/101', repository: 'gnolang/gno',
        authorLogin: 'alice', authorAvatarUrl: '', state: 'OPEN', isDraft: false,
        reviewDecision: 'REVIEW_REQUIRED', status: 'In progress', mainArea: 'VM',
        additions: 10, deletions: 2, labels: [], assignees: [], requestedReviewers: ['bob'],
        reviews: [], createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-04T00:00:00Z' },
]

const DEV_ITEMS = [
    { itemID: 'd1', boardId: 'gnoland-dev', itemType: 'pr', number: 201, title: 'Dev PR in review',
        url: 'https://github.com/gnolang/gno/pull/201', repository: 'gnolang/gno',
        authorLogin: 'carol', authorAvatarUrl: '', state: 'OPEN', isDraft: false,
        reviewDecision: 'REVIEW_REQUIRED', status: 'In Review', mainArea: 'UX',
        additions: 5, deletions: 1, labels: [{ name: 'a/ux', color: '' }], assignees: [],
        requestedReviewers: [], reviews: [], createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-04T00:00:00Z' },
    { itemID: 'd2', boardId: 'gnoland-dev', itemType: 'issue', number: 202, title: 'Dev issue open',
        url: 'https://github.com/gnolang/gno/issues/202', repository: 'gnolang/gno',
        authorLogin: 'dan', authorAvatarUrl: '', state: 'OPEN', isDraft: false,
        reviewDecision: '', status: 'Todo', mainArea: 'VM',
        additions: 0, deletions: 0, labels: [{ name: 'a/vm', color: '' }], assignees: [],
        requestedReviewers: [], reviews: [], createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-03T00:00:00Z' },
]

test.describe('Gnolove Notable PRs — multi-board', () => {
    test.beforeEach(async ({ page }) => {
        await page.route('**/projects/boards', r => r.fulfill({ json: BOARDS }))
        await page.route('**/projects/notable**', r => {
            const board = new URL(r.request().url()).searchParams.get('board') || 'notable'
            r.fulfill({ json: board === 'gnoland-dev' ? DEV_ITEMS : NOTABLE_ITEMS })
        })
    })

    test('board selector switches board: URL, heading and content', async ({ page }) => {
        await page.goto('/test12/gnolove/notable-prs')
        await expect(page.getByRole('heading', { name: 'Notable PRs' })).toBeVisible()
        await expect(page.getByText('Notable PR one')).toBeVisible()

        const devTab = page.getByRole('tab', { name: 'Gno.land development' })
        await expect(devTab).toBeVisible()
        await devTab.click()

        await expect(page).toHaveURL(/board=gnoland-dev/)
        await expect(page.getByRole('heading', { name: 'Gno.land development' })).toBeVisible()
        await expect(page.getByText('Dev PR in review')).toBeVisible()
    })

    test('issues are hidden under Needs-review and shown when it is off', async ({ page }) => {
        await page.goto('/test12/gnolove/notable-prs?board=gnoland-dev')
        // Needs-review defaults ON → issues (which never "need review") are hidden.
        await expect(page.getByText('Dev issue open')).toBeHidden()
        await page.getByText('Needs review').click()
        await expect(page.getByText('Dev issue open')).toBeVisible()
    })

    test('Hide-done drops the Done column in board view', async ({ page }) => {
        await page.goto('/test12/gnolove/notable-prs?board=gnoland-dev')
        await page.getByText('Needs review').click() // surface all statuses
        await page.getByRole('button', { name: /Board/ }).click()

        await expect(page.locator('.gl-np-col-head', { hasText: 'In Review' })).toBeVisible()
        // Hide-done is ON by default → no Done column.
        await expect(page.locator('.gl-np-col-head', { hasText: 'Done' })).toHaveCount(0)
        // Toggle it off → Done column appears.
        await page.getByText('Hide done').click()
        await expect(page.locator('.gl-np-col-head', { hasText: 'Done' })).toHaveCount(1)
    })
})
