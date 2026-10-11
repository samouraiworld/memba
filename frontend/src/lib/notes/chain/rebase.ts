import type { DraftBase } from '../drafts'
import { mergeNoteText, type NoteBaseText, type NoteText } from '../merge'
import { trimPublicTitle } from '../publicFields'
import type { NotesReadClient } from './client'
import { readPublicHistoryBody } from './historyBody'
import { publicText, type ChainNote } from './schema'

export type RebaseClient = Pick<NotesReadClient, 'assertCurrent' | 'publicHistoryInfo' | 'publicHistoryVersion' | 'publicHistoryBodyChunk'>
export type RebasePlan =
    /** The draft already follows the latest revision. */
    | { kind: 'current' }
    /** The read is older than the draft's own revision (a lagging node): change nothing, retry later. */
    | { kind: 'behind'; latest: ChainNote; baseRevision: string }
    /** The draft holds no changes of its own: continue from the latest revision. */
    | { kind: 'replace'; latest: ChainNote; title: string; body: string }
    /** The draft's changes apply cleanly on top of the latest revision. */
    | { kind: 'merged'; latest: ChainNote; title: string; body: string }
    /** Overlapping or unverifiable changes: the caller must keep the draft text untouched. */
    | { kind: 'conflict'; latest: ChainNote; fields: ('title' | 'body')[]; baseRevision: string | null; theirs: NoteText }

/**
 * Plans moving a public draft onto `latest`, a verified live note. Base text comes from public
 * history (only for fields that changed on chain). A creation draft without a baseline is treated
 * as based on the first public version, since note IDs are random per draft.
 */
export async function planDraftRebase(client: RebaseClient, saved: { title: string; body: string; base?: DraftBase }, latest: ChainNote): Promise<RebasePlan> {
    const { base } = saved
    if (base && BigInt(latest.stateRevision) < BigInt(base.stateRevision)) return { kind: 'behind', latest, baseRevision: base.stateRevision }
    if (base && base.stateRevision === latest.stateRevision && base.epoch === latest.epoch && base.ownerGeneration === latest.ownerGeneration) return { kind: 'current' }
    // Compare and merge the title as it would be published (draftPublicOperation trims edge spaces).
    const draft = { title: trimPublicTitle(saved.title), body: saved.body }
    const theirs = { title: publicText(latest.title, true), body: publicText(latest.body!) }
    const replace = { kind: 'replace' as const, latest, ...theirs }
    if (draft.title === theirs.title && draft.body === theirs.body) return replace
    const original = await baseText(client, latest, theirs, base)
    if (original.title === draft.title && original.body === draft.body) return replace
    const merged = mergeNoteText(original, draft, theirs)
    if (merged.status === 'conflict') return { kind: 'conflict', latest, fields: merged.fields, baseRevision: base?.stateRevision ?? null, theirs }
    if (merged.title === theirs.title && merged.body === theirs.body) return replace
    return { kind: 'merged', latest, title: merged.title, body: merged.body }
}

async function baseText(client: RebaseClient, latest: ChainNote, theirs: NoteText, base?: DraftBase): Promise<NoteBaseText> {
    if (!base) {
        client.assertCurrent()
        const info = await client.publicHistoryInfo(latest.id); client.assertCurrent()
        return info ? versionText(client, latest.id, info.startStateRevision) : { title: null, body: null }
    }
    const title = base.titleRevision === latest.titleRevision ? theirs.title : (await versionText(client, latest.id, base.stateRevision, false)).title
    const body = base.bodyRevision === latest.bodyRevision ? theirs.body : await bodyText(client, latest.id, base.bodyRevision)
    return { title, body }
}
async function versionText(client: RebaseClient, noteId: string, stateRevision: string, withBody = true): Promise<NoteBaseText> {
    client.assertCurrent()
    const version = await client.publicHistoryVersion(noteId, stateRevision); client.assertCurrent()
    if (!version || version.deleted) return { title: null, body: null }
    return {
        title: version.title === null ? null : publicText(version.title, true),
        body: withBody && version.bodyRevision !== null && !version.bodyRedacted ? await bodyText(client, noteId, version.bodyRevision) : null,
    }
}
async function bodyText(client: RebaseClient, noteId: string, bodyRevision: string): Promise<string | null> {
    const body = await readPublicHistoryBody(client, noteId, bodyRevision); client.assertCurrent()
    return body?.text ?? null
}
