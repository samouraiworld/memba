import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { adoptDraft, draftKey, loadDraft, saveDraft, LEGACY_DRAFT_KEY, type DraftData, clearDraftMemory } from './drafts'
const a = { chainId: 'gnoland-1', wallet: 'alice' }
const draft: DraftData = {
    name: 'My DAO', description: '', realmPath: 'gno.land/r/alice/team', members: [],
    threshold: 51, quorum: 0, availableRoles: ['member'], proposalCategories: ['governance'],
    selectedPreset: null, step: 1, savedAt: Date.now(),
}
beforeEach(() => { localStorage.clear(); clearDraftMemory() })
afterEach(() => vi.restoreAllMocks())
describe('DAO draft context', () => {
    it('never resumes another wallet or chain draft', () => {
        saveDraft(a, draft)
        expect(loadDraft({ ...a, wallet: 'bob' })).toBeNull()
        expect(loadDraft({ ...a, chainId: 'pearl-1' })).toBeNull()
        expect(loadDraft(a)?.data.name).toBe('My DAO')
    })
    it('offers an unbound draft for explicit adoption on the same chain only', () => {
        const unbound = { ...a, wallet: '' }
        saveDraft(unbound, draft)
        expect(loadDraft({ ...a, chainId: 'pearl-1' })).toBeNull()
        const candidate = loadDraft(a)!
        expect(candidate.needsAdoption).toBe(true)
        expect(localStorage.getItem(draftKey(a))).toBeNull()
        adoptDraft(a, candidate)
        expect(loadDraft(a)?.needsAdoption).toBe(false)
        expect(localStorage.getItem(draftKey(unbound))).toBeNull()
    })
    it('preserves a legacy draft if adoption cannot be committed', () => {
        const original = JSON.stringify(draft)
        localStorage.setItem(LEGACY_DRAFT_KEY, original)
        const candidate = loadDraft(a)!
        vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded') })
        expect(() => adoptDraft(a, candidate)).toThrow()
        expect(localStorage.getItem(LEGACY_DRAFT_KEY)).toBe(original)
    })
    it('does not overwrite another scoped draft with a legacy draft', () => {
        localStorage.setItem(LEGACY_DRAFT_KEY, JSON.stringify(draft))
        saveDraft(a, { ...draft, name: 'Scoped' })
        expect(loadDraft(a)?.data.name).toBe('Scoped')
        expect(loadDraft(a)?.needsAdoption).toBe(false)
    })
    it.each([null, { version: 99 }, { version: 2, ...a, data: { ...draft, savedAt: 0 } }])('ignores invalid/expired envelopes without deleting recoverable data', value => {
        const raw = JSON.stringify(value)
        localStorage.setItem(draftKey(a), raw)
        expect(loadDraft(a)).toBeNull()
        expect(localStorage.getItem(draftKey(a))).toBe(raw)
    })
})
