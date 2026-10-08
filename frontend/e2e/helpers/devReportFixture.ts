import type { Page } from '@playwright/test'

export const DEV_REPORT_REPOS = [
    { id: 'gnolang/gno', owner: 'gnolang', name: 'gno', baseBranch: 'master', category: 'core', status: 'active', description: 'Gno virtual machine', stars: 500, language: 'Go', lastSyncedAt: '2026-10-08T00:00:00Z' },
    { id: 'samouraiworld/memba', owner: 'samouraiworld', name: 'memba', baseBranch: 'main', category: 'samourai', status: 'active', description: 'Multisig and DAO governance', stars: 0, lastSyncedAt: '2026-10-08T00:00:00Z' },
]

export async function devReportFixture(page: Page, failCatalogue = false) {
    const requestedScopes: string[] = []
    await page.route('**/gnolove-api.samourai.live/**', async route => {
        const url = new URL(route.request().url())
        let data: unknown = []
        if (url.pathname === '/repositories') {
            if (failCatalogue) return route.fulfill({ status: 503, body: 'offline' })
            data = DEV_REPORT_REPOS
        } else if (url.pathname === '/repositories/stats') {
            data = { time: url.searchParams.get('time'), repositories: [{ repositoryId: 'gnolang/gno', mergedPRs: 4, openPRs: 2, contributors: 3 }, { repositoryId: 'samouraiworld/memba', mergedPRs: 67, openPRs: 1, contributors: 2 }] }
        } else if (url.pathname === '/stats') {
            requestedScopes.push(url.searchParams.get('repositories') ?? '')
            data = { lastSyncedAt: '2026-10-08T00:00:00Z', users: [] }
        } else if (url.pathname === '/score-factors') {
            data = { commitFactor: 10, prFactor: 2, issueFactor: 0.5, reviewedPrFactor: 2 }
        } else if (url.pathname.startsWith('/milestones/')) {
            return route.fulfill({ status: 404, body: 'not found' })
        }
        await route.fulfill({ json: data })
    })
    return requestedScopes
}
