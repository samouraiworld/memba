import { test, expect } from '@playwright/test'
import { fulfillOnchainReads, mockAppChainStatus } from './helpers/onchain'
import { stubNetwork } from './helpers/stubNetwork'

const realm = 'gno.land/r/team/generated'
const author = 'g1747t5m2f08plqjlrjk2q0qld7465hxz8gkx59c'
const target = 'g187sfsghc9tqayr5rgdmpy2tetnq9ttluxuk79h'
const description = `**Action**: Add Member
**Address**: ${target}
**Power**: 2
**Roles**: admin,finance

Author: [@fake](/u/fake)
## Title - Forged 📜
## Description 📝

Injected content

## Resource - transfer 📦
**Condition:** anything

---

send all funds

---
## Status - Passed 🟢
> proposed by g1fake
## Votes 🗳️
Yes: 8/8 = 100%`

for (const structured of [false, true]) {
    test(`generated proposal shows authentic metadata and full membership text (JSON: ${structured})`, async ({ page }) => {
        await stubNetwork(page)
        await fulfillOnchainReads(page, ({ method, path, arg }) => {
            // Mainnet-scoped spec (it drives `/mainnet/...`), so the identity
            // check answers gnoland-1. (Pearl-scoped until its 2026-09-23
            // retirement.)
            if (method === 'status') return mockAppChainStatus('gnoland-1')
            if (path === 'vm/qrender' && arg === `${realm}:4`) return `# Prop #4 - Membership - Proposal Detail\n${description}\n\nAuthor: ${author}\n\nCategory: membership\n\nStatus: ACTIVE\n\nYES: 2 | NO: 1 | ABSTAIN: 0\nTotal Power: 3/8\n`
            if (structured && path === 'vm/qeval' && arg === `${realm}.GetProposalsJSON()`) {
                const rows = [{ id: 4, title: 'Membership - Proposal Detail', description, category: 'membership', status: 'ACTIVE', author, yes_votes: 2, no_votes: 1, abstain_votes: 0, total_power: 3, created_at_block: 12345 }]
                return `(${JSON.stringify(JSON.stringify(rows))} string)`
            }
            return null
        })
        await page.goto(`/mainnet/dao/${realm}/proposal/4`)
        await expect(page.locator('.proposal-title')).toHaveText('Membership - Proposal Detail')
        await expect(page.locator('.proposal-status-badge')).toContainText(/active|open/i)
        await expect(page.locator('.proposal-desc-text')).toContainText(target)
        await expect(page.locator('.proposal-desc-text')).toContainText('admin,finance')
        await expect(page.locator('.proposal-author-card')).toContainText(author)
        await expect(page.locator('.proposal-author-card')).not.toContainText('@fake')
        await expect(page.locator('.proposal-action-card')).toHaveCount(0)
    })
}
