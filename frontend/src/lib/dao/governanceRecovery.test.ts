import { beforeEach, describe, expect, it, vi } from 'vitest'
import { beginGovernanceRequest, clearGovernanceMemory, clearGovernanceReceipt, clearProposalDraft, governanceRequestActive, readGovernanceReceipt, readProposalDraft, saveGovernanceReceipt, saveProposalDraft } from './governanceRecovery'
const scope = { chainId: 'gnoland-1', realmPath: 'gno.land/r/alice/dao', caller: 'alice', operation: 'vote:1' }
beforeEach(() => { clearGovernanceMemory(); localStorage.clear(); vi.restoreAllMocks() })
describe('governance recovery', () => {
    it('separates chain, realm, caller and action receipts', () => {
        saveGovernanceReceipt(scope, { phase: 'intent', hash: '', label: 'Vote YES' })
        for (const changed of [{ chainId: 'pearl-1' }, { realmPath: 'gno.land/r/bob/dao' }, { caller: 'bob' }, { operation: 'vote:2' }]) {
            expect(readGovernanceReceipt({ ...scope, ...changed })).toBeNull()
        }
        clearGovernanceMemory()
        expect(readGovernanceReceipt(scope)?.phase).toBe('intent')
    })
    it('refuses duplicate requests and clearing while a request is pending', () => {
        const finish = beginGovernanceRequest(scope)
        expect(governanceRequestActive(scope)).toBe(true)
        expect(() => beginGovernanceRequest(scope)).toThrow('already in progress')
        expect(() => clearGovernanceReceipt(scope)).toThrow('still in progress')
        finish()
        expect(governanceRequestActive(scope)).toBe(false)
        expect(() => clearGovernanceReceipt(scope)).not.toThrow()
    })
    it('requires durable initial intent but retains a known hash if storage later fails', () => {
        vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
        expect(() => saveGovernanceReceipt(scope, { phase: 'intent', hash: '', label: 'Vote YES' })).toThrow('quota')
        expect(readGovernanceReceipt(scope)).toBeNull()
        expect(() => saveGovernanceReceipt(scope, { phase: 'submitted', hash: 'knownhash', label: 'Vote YES' })).toThrow('quota')
        expect(readGovernanceReceipt(scope)?.hash).toBe('knownhash')
    })
    it('reports a draft removal failure while leaving the persisted draft available', () => {
        const draftScope = { ...scope, operation: 'proposal-draft:test' }
        const draft = { kind: 'text' as const, title: 'A proposal', description: '', category: 'governance', target: '', powerText: '', roles: null }
        saveProposalDraft(draftScope, draft)
        vi.spyOn(localStorage, 'removeItem').mockImplementation(() => { throw new Error('storage refused') })
        expect(clearProposalDraft(draftScope)).toBe(false)
        expect(readProposalDraft(draftScope)).toEqual(draft)
    })
})
