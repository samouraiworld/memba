import { expect, it, vi } from 'vitest'
import { itemForTarget, itemTarget } from './desk'
vi.mock('../../lib/notes/config', async original => ({ ...await original<typeof import('../../lib/notes/config')>(), NOTES_ENABLED: true }))
it('round-trips a strict public note desktop target and leaves the library as an app pin', () => {
    const id = 'ab'.repeat(16), target = { kind: 'app', app: 'notes', section: id } as const
    expect(itemForTarget(target)).toEqual({ ty: 'note', ref: id })
    expect(itemTarget({ ty: 'note', ref: id })).toEqual(target)
    expect(itemTarget({ ty: 'note', ref: id + '/extra' })).toBeNull()
    expect(itemForTarget({ kind: 'app', app: 'notes', section: null })).toEqual({ ty: 'app', ref: 'notes' })
})
