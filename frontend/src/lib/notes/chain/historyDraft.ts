import type { NotesReadClient } from './client'
import type { PublicHistoryInfo } from './history'
import type { PublicHistoryVersion } from './historyContent'
import { readPublicHistoryBody } from './historyBody'
import { check, publicText } from './schema'

/** Archived title and body copied out of the public history, for a new local draft. */
export type ArchivedPublicDraft = { noteId: string; sourceStateRevision: string; title: string; body: string }
export type LoadedVersion = { version: PublicHistoryVersion; draft: ArchivedPublicDraft | null }

export function restrictedHistory(info: PublicHistoryInfo): boolean { return info.deleted || info.moderatorHidden }
export async function currentHistoryInfo(client: NotesReadClient, noteId: string): Promise<PublicHistoryInfo> {
    client.assertCurrent()
    const info = await client.publicHistoryInfo(noteId)
    client.assertCurrent(); check(info !== null)
    return info
}
export function sameHistoryHead(before: PublicHistoryInfo, after: PublicHistoryInfo): void {
    check(before.headSeq === after.headSeq && before.deleted === after.deleted && before.moderatorHidden === after.moderatorHidden)
}
/** One archived version with its body, checked against the recorded size and digest. Redacted or deleted versions carry no draft. */
export async function readArchivedVersion(client: NotesReadClient, noteId: string, revision: string): Promise<LoadedVersion> {
    const version = await client.publicHistoryVersion(noteId, revision)
    client.assertCurrent(); check(version !== null)
    // Redacted bytes are gone from the realm; such a version cannot be shown or restored.
    if (version.deleted || version.titleRedacted || version.bodyRedacted) return { version, draft: null }
    check(version.title !== null && version.bodyRevision !== null)
    // The body is addressed by the event that recorded this version, then bound to its revision and digest.
    const body = await readPublicHistoryBody(client, noteId, version.recordedSeq)
    client.assertCurrent()
    check(body !== null && body.id === version.id && body.bodyRevision === version.bodyRevision && body.sha256 === version.bodySha256 && new TextEncoder().encode(body.text).length === version.bodyBytes)
    return { version, draft: { noteId, sourceStateRevision: revision, title: publicText(version.title, true), body: body.text } }
}
/**
 * "Use as draft" straight from the timeline: the archived content of `revision`, only while the
 * note is live and visible and its history head did not move during the read. Null when that
 * version has no restorable content (redacted or a deletion record).
 */
export async function readRestorableVersion(client: NotesReadClient, noteId: string, revision: string): Promise<ArchivedPublicDraft | null> {
    const before = await currentHistoryInfo(client, noteId)
    check(!restrictedHistory(before))
    const { draft } = await readArchivedVersion(client, noteId, revision)
    sameHistoryHead(before, await currentHistoryInfo(client, noteId))
    return draft
}
