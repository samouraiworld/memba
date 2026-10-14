import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { ChainNote } from './schema'
import { planDraftRebase, type RebaseClient } from './rebase'

const history = vi.hoisted(() => ({ body: vi.fn() }))
vi.mock('./historyBody', () => ({ readPublicHistoryBody: history.body }))
const utf8 = (value: string) => new TextEncoder().encode(value)
const id = 'ab'.repeat(16)
const latest = { id, owner: 'owner', actor: 'g1747actor', mode: 4, deleted: false, stateRevision: '5', titleRevision: '4', bodyRevision: '3', epoch: '0', ownerGeneration: '1',
    title: utf8('Groceries'), body: utf8('- milk\n- eggs\n- bread\n- avocados') } as ChainNote
const base = { stateRevision: '4', epoch: '0', ownerGeneration: '1', titleRevision: '4', bodyRevision: '2' }
const digest = (value: string) => bytesToHex(sha256(utf8(value)))
/** Archived bodies by the event seq that recorded them; seq and field revision differ on purpose. */
const bodies: Record<string, { bodyRevision: string; text: string }> = { '1': { bodyRevision: '1', text: '- milk\n- eggs\n- bread' }, '6': { bodyRevision: '2', text: '- milk\n- eggs\n- bread' } }
type Version = { title: Uint8Array | null; titleRevision?: string | null; bodyRevision: string | null; recordedSeq?: string; deleted?: boolean; bodyRedacted?: boolean; bodySha256?: string }
function client(versions: Record<string, Version> = { '4': { title: utf8('Groceries'), bodyRevision: '2', recordedSeq: '6' } }) {
    return {
        assertCurrent: vi.fn(),
        publicHistoryInfo: vi.fn(async () => ({ startStateRevision: '1' })),
        publicHistoryVersion: vi.fn(async (_id: string, revision: string) => {
            const v = versions[revision], seq = v?.recordedSeq ?? revision
            return v ? { deleted: false, bodyRedacted: false, titleRevision: '4', recordedSeq: seq, bodySha256: bodies[seq] ? digest(bodies[seq].text) : null, ...v } : null
        }),
        publicHistoryBodyChunk: vi.fn(),
    } as unknown as RebaseClient & { publicHistoryVersion: ReturnType<typeof vi.fn> }
}
beforeEach(() => {
    vi.clearAllMocks()
    history.body.mockImplementation(async (_c: unknown, _id: string, seq: string) => bodies[seq] ? { seq, ...bodies[seq], sha256: digest(bodies[seq].text) } : null)
})

describe('draft rebase planning', () => {
    it('leaves a draft based on the latest revision alone', async () => {
        expect(await planDraftRebase(client(), { title: 'x', body: 'y', base: { ...base, stateRevision: '5', bodyRevision: '3' } }, latest)).toEqual({ kind: 'current' })
    })
    it('starts from the latest revision when the draft has no changes of its own', async () => {
        const plan = await planDraftRebase(client(), { title: 'Groceries', body: '- milk\n- eggs\n- bread', base }, latest)
        expect(plan).toMatchObject({ kind: 'replace', title: 'Groceries', body: '- milk\n- eggs\n- bread\n- avocados', latest })
        expect(history.body).toHaveBeenCalledWith(expect.anything(), id, '6')
    })
    it('merges disjoint changes onto the latest revision and fetches only changed base fields', async () => {
        const c = client()
        const plan = await planDraftRebase(c, { title: 'Groceries', body: '- MILK\n- eggs\n- bread', base }, latest)
        expect(plan).toMatchObject({ kind: 'merged', title: 'Groceries', body: '- MILK\n- eggs\n- bread\n- avocados' })
        // The base body is addressed by the event that recorded the base version: one version read, then its body.
        expect(c.publicHistoryVersion).toHaveBeenCalledExactlyOnceWith(id, '4')
        expect(history.body).toHaveBeenCalledExactlyOnceWith(expect.anything(), id, '6')
    })
    it('refuses a base version or archived body that does not match the draft base', async () => {
        const mine = { title: 'Groceries', body: '- MILK\n- eggs\n- bread', base }
        // The version at the base state revision must carry the body revision the draft was based on.
        await expect(planDraftRebase(client({ '4': { title: utf8('Groceries'), bodyRevision: '1', recordedSeq: '6' } }), mine, latest)).rejects.toThrow('format')
        await expect(planDraftRebase(client({ '4': { title: utf8('Groceries'), titleRevision: '3', bodyRevision: '2', recordedSeq: '6' } }), mine, latest)).rejects.toThrow('format')
        // The body read by seq must be that revision, with the digest the version recorded.
        await expect(planDraftRebase(client({ '4': { title: utf8('Groceries'), bodyRevision: '2', recordedSeq: '1' } }), mine, latest)).rejects.toThrow('format')
        await expect(planDraftRebase(client({ '4': { title: utf8('Groceries'), bodyRevision: '2', recordedSeq: '6', bodySha256: 'f'.repeat(64) } }), mine, latest)).rejects.toThrow('format')
    })
    it('treats a moderator-redacted base body as unverifiable without reading it', async () => {
        const c = client({ '4': { title: utf8('Groceries'), bodyRevision: '2', recordedSeq: '6', bodyRedacted: true } })
        expect(await planDraftRebase(c, { title: 'Groceries', body: 'mine', base }, latest)).toMatchObject({ kind: 'conflict', fields: ['body'] })
        expect(c.publicHistoryVersion).toHaveBeenCalledExactlyOnceWith(id, '4'); expect(history.body).not.toHaveBeenCalled()
    })
    it('treats a deleted or missing base version as unverifiable, never as empty text', async () => {
        for (const versions of [{}, { '4': { title: null, bodyRevision: null, deleted: true } }] as Record<string, Version>[]) {
            expect(await planDraftRebase(client(versions), { title: 'Groceries', body: 'mine', base }, latest)).toMatchObject({ kind: 'conflict', fields: ['body'] })
        }
        expect(history.body).not.toHaveBeenCalled()
    })
    it('reports overlapping changes as a conflict naming the field and who published', async () => {
        const plan = await planDraftRebase(client(), { title: 'Groceries', body: '- milk\n- eggs\n- bread\n- butter', base }, latest)
        expect(plan).toMatchObject({ kind: 'conflict', fields: ['body'], baseRevision: '4', latest: { stateRevision: '5', actor: 'g1747actor' }, theirs: { body: '- milk\n- eggs\n- bread\n- avocados' }, lines: [{ line: 4, text: '- butter' }] })
    })
    it('keeps own edits across a revision that changed no content', async () => {
        const c = client()
        const plan = await planDraftRebase(c, { title: 'Mine', body: 'anything', base: { ...base, titleRevision: '4', bodyRevision: '3' } }, latest)
        expect(plan).toMatchObject({ kind: 'merged', title: 'Mine', body: 'anything' })
        expect(history.body).not.toHaveBeenCalled(); expect(c.publicHistoryVersion).not.toHaveBeenCalled()
    })
    it('reads the older title from the base version when the title changed on chain', async () => {
        const c = client({ '4': { title: utf8('Old'), titleRevision: '3', bodyRevision: '3' } })
        const plan = await planDraftRebase(c, { title: 'Old', body: '- milk\n- eggs\n- bread\n- cheese', base: { ...base, titleRevision: '3', bodyRevision: '3' } }, latest)
        expect(c.publicHistoryVersion).toHaveBeenCalledWith(id, '4')
        expect(plan).toMatchObject({ kind: 'merged', title: 'Groceries', body: '- milk\n- eggs\n- bread\n- cheese' })
    })
    it('treats a creation draft on an existing note as based on the first public version', async () => {
        const c = client({ '1': { title: utf8('Groceries'), bodyRevision: '1' } })
        expect(await planDraftRebase(c, { title: 'Groceries', body: '- milk\n- eggs\n- bread' }, latest)).toMatchObject({ kind: 'replace', latest })
        expect(await planDraftRebase(c, { title: 'Groceries', body: 'Intro\n- milk\n- eggs\n- bread' }, latest)).toMatchObject({ kind: 'merged', body: 'Intro\n- milk\n- eggs\n- bread\n- avocados' })
    })
    it('never merges against a redacted base', async () => {
        history.body.mockResolvedValue(null)
        expect(await planDraftRebase(client(), { title: 'Groceries', body: 'mine', base }, latest)).toMatchObject({ kind: 'conflict', fields: ['body'] })
        expect(await planDraftRebase(client(), { title: 'Groceries', body: '- milk\n- eggs\n- bread\n- avocados', base }, latest)).toMatchObject({ kind: 'replace' })
    })
    it('never moves a draft backward onto a lagging read', async () => {
        const c = client()
        const lagging = { ...latest, stateRevision: '5' }
        for (const draft of [{ title: 'Groceries', body: '- milk' }, { title: 'Groceries', body: '- milk\n- eggs\n- bread\n- avocados' }]) {
            expect(await planDraftRebase(c, { ...draft, base: { ...base, stateRevision: '6' } }, lagging)).toEqual({ kind: 'behind', latest: lagging, baseRevision: '6' })
        }
        expect(history.body).not.toHaveBeenCalled(); expect(c.publicHistoryVersion).not.toHaveBeenCalled()
    })
    it('compares titles the way they are published, without edge spaces', async () => {
        expect(await planDraftRebase(client(), { title: '  Groceries ', body: '- milk\n- eggs\n- bread\n- avocados', base }, latest)).toMatchObject({ kind: 'replace' })
        expect(await planDraftRebase(client(), { title: ' Groceries', body: '- milk\n- eggs\n- bread', base }, latest)).toMatchObject({ kind: 'replace', title: 'Groceries' })
    })
})
