import type { Page } from '@playwright/test'
import { fulfillOnchainReads, mockChainStatus } from './onchain'
export const proposalRows = [
    { id: 4, title: 'Fund the community education programme', status: 'open', author: '@alice', yes_votes: 2, no_votes: 1, abstain_votes: 1 },
    { id: 3, title: 'Approve the validator onboarding policy', status: 'passed', author: '@bruno', yes_votes: 8, no_votes: 0 },
    { id: 2, title: 'Publish the quarterly treasury report', status: 'executed', author: '@charlie', yes_votes: 9 },
    { id: 1, title: 'Adjust the proposal review window', status: 'rejected', author: '@alice', yes_votes: 1, no_votes: 8 },
]
export async function fulfillGovernance(page: Page, options: { empty?: boolean; missing?: boolean } = {}) {
    await fulfillOnchainReads(page, ({ path, arg, method }) => {
        if (method === 'status') return mockChainStatus()
        if (path === 'vm/qrender' && arg === 'gno.land/r/gov/dao:') return '# GovDAO\n\nGno chain governance — proposals and membership management.\n\n[Memberstore](https://gno.land/r/gov/dao/v3/memberstore)\n\n## Proposals\n\nThreshold: 66%'
        if (path === 'vm/qrender' && arg === 'gno.land/r/gov/dao/v3/memberstore:') return '# GovDAO Memberstore\nTier T1 contains 2 members with power: 6\nTier T2 contains 3 members with power: 6\nTier T3 contains 5 members with power: 5'
        if (path === 'vm/qeval' && arg.includes('GetMembersJSON')) return `(${JSON.stringify(JSON.stringify([
            { address: 'g1fixturealice00000000000000000000000000', username: '@alice', tier: 'T1', roles: ['member'] },
            { address: 'g1fixturebruno00000000000000000000000000', username: '@bruno', tier: 'T2', roles: ['member'] },
            { address: 'g1fixturecharlie000000000000000000000000', username: '@charlie', tier: 'T3', roles: ['member'] },
        ]))} string)`
        if (path === 'vm/qeval' && arg.includes('GetProposalsJSON')) return `(${JSON.stringify(JSON.stringify(options.empty ? [] : proposalRows))} string)`
        const match = /^gno\.land\/r\/gov\/dao:(?:proposal\/|:)?(\d+)$/.exec(arg)
        if (path === 'vm/qrender' && match && !options.missing) {
            const p = proposalRows.find(p => p.id === Number(match[1]))
            if (!p) return null
            return `# Prop #${p.id} - ${p.title}\n\nStatus: ${p.status === "open" ? "ACTIVE" : p.status.toUpperCase()}\n\nAuthor: [${p.author}](https://gno.land/r/demo/profile)\n\nThis proposal establishes a clear review process for community initiatives. Members can inspect the scope, milestones and proposed action before making a decision.\n\nThe programme will publish progress reports and invite community feedback at each milestone.\n\n## Details\nStatus: ${p.status}\n**Yes**: ${p.yes_votes || 0}\n**No**: ${p.no_votes || 0}\n**Abstain**: ${'abstain_votes' in p ? p.abstain_votes : 0}\nCategory: governance\n\nThis proposal contains the following metadata:\n\nPublishPolicy("community-education-v1")\n\nExecutor created in: gno.land/r/gov/policy\n\n---`
        }
        return null
    })
}
