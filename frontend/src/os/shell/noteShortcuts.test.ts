import { beforeEach, describe, expect, it } from 'vitest'
import type { ChainNote } from '../../lib/notes/chain/schema'
import { noteShortcutCacheKey, noteShortcutLabel, readNoteShortcuts, shortcutFromChain, writeNoteShortcuts } from './noteShortcuts'

const id = 'ab'.repeat(16), other = 'cd'.repeat(16)
const meta = (patch: Partial<ChainNote> = {}): ChainNote => ({ id, owner: 'g1owner', pendingOwner: '', ownerGeneration: '1', mode: 3, stateRevision: '2', titleRevision: '1', bodyRevision: '1', epoch: '0',
    title: new TextEncoder().encode('Sushi'), commitment: new Uint8Array(), deleted: false, listed: true, createdHeight: '1', operationId: 'ef'.repeat(16), actor: 'g1owner', height: '3', ...patch })

beforeEach(() => localStorage.clear())

describe('note shortcut facts', () => {
    it('reads a public title from the chain', () => {
        expect(shortcutFromChain(meta())).toEqual({ title: 'Sushi', private: false, missing: false })
    })
    it('never derives a title for a private note', () => {
        expect(shortcutFromChain(meta({ mode: 1, title: new Uint8Array(40).fill(7) }))).toEqual({ title: null, private: true, missing: false })
    })
    it('marks deleted and absent notes missing but keeps the last known label', () => {
        const known = { title: 'Sushi', private: false, missing: false }
        expect(shortcutFromChain(meta({ deleted: true }), known)).toEqual({ title: 'Sushi', private: false, missing: true })
        expect(shortcutFromChain(null, known)).toEqual({ title: 'Sushi', private: false, missing: true })
        expect(shortcutFromChain(null)).toEqual({ title: null, private: false, missing: true })
    })
    it('keeps the previous title when the chain title cannot be decoded', () => {
        expect(shortcutFromChain(meta({ title: new Uint8Array([0xff]) }), { title: 'Old', private: false, missing: false }).title).toBe('Old')
    })
    it('labels a shortcut with the featured label, then the known title, then "Note"', () => {
        expect(noteShortcutLabel('Sushi recipe', { title: 'Sushi', private: false, missing: false })).toBe('Sushi recipe')
        expect(noteShortcutLabel(undefined, { title: 'Sushi', private: false, missing: false })).toBe('Sushi')
        expect(noteShortcutLabel(undefined, { title: null, private: true, missing: false })).toBe('Note')
        expect(noteShortcutLabel(undefined, undefined)).toBe('Note')
    })
})

describe('note shortcut cache', () => {
    it('is scoped per network and wallet like the desk', () => {
        expect(noteShortcutCacheKey('gnoland-1', 'g1a')).not.toBe(noteShortcutCacheKey('gnoland-1', 'g1b'))
        expect(noteShortcutCacheKey('gnoland-1', null)).not.toBe(noteShortcutCacheKey('onyx-1', null))
        writeNoteShortcuts('gnoland-1', 'g1a', { [id]: { title: 'Sushi', private: false, missing: false } }, [id])
        expect(readNoteShortcuts('gnoland-1', 'g1a')[id]?.title).toBe('Sushi')
        expect(readNoteShortcuts('gnoland-1', 'g1b')).toEqual({})
    })
    it('keeps only the shortcuts still on the desk and never stores a private title', () => {
        writeNoteShortcuts('gnoland-1', null, {
            [id]: { title: 'Secret plan', private: true, missing: false },
            [other]: { title: 'Gone', private: false, missing: false },
        }, [id])
        const raw = localStorage.getItem(noteShortcutCacheKey('gnoland-1', null)) ?? ''
        expect(raw).not.toContain('Secret plan'); expect(raw).not.toContain('Gone')
        expect(readNoteShortcuts('gnoland-1', null)).toEqual({ [id]: { title: null, private: true, missing: false } })
    })
    it('ignores malformed or hostile cache contents', () => {
        const key = noteShortcutCacheKey('gnoland-1', null)
        for (const raw of ['{', '[]', 'null', JSON.stringify({ [id]: 'x' }), JSON.stringify({ '../x': { t: 'A' } }), JSON.stringify({ [id]: { t: 5 } })]) {
            localStorage.setItem(key, raw)
            expect(readNoteShortcuts('gnoland-1', null)).toEqual({})
        }
        localStorage.setItem(key, JSON.stringify({ [id]: { t: 'x'.repeat(81) } }))
        expect(readNoteShortcuts('gnoland-1', null)).toEqual({})
    })
})
