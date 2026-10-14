/**
 * An unsent comment on a public note, kept in this tab's session storage so a lock, an
 * account or network switch, or a reload does not lose it. Comments are public text on a
 * public note; private note content never goes here, and nothing goes to localStorage.
 * Cleared once the comment is posted or emptied.
 *
 * A comment the wallet has sent is held aside until its outcome, and every composer for the note in this
 * tab (open now or opened later) lets it go: a posted comment is never offered again, so it cannot be paid
 * for twice. Any other outcome gives the text back (its receipt still blocks a resend until checked), merged
 * with anything written meanwhile: returned text is never dropped.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export interface CommentDraftScope { chainId: string; owner: string; noteId: string }
export interface StoredCommentDraft { body: string; quote: { text: string; bodyRevision: string; confirmedFor: string } }

const PREFIX = 'memba_notes_comment:v1:', SENT = 'memba_notes_comment_sent:v1:'
const key = ({ chainId, owner, noteId }: CommentDraftScope) => `${PREFIX}${chainId}:${owner}:${noteId}`
/** A composer's limit, twice over: returned text merged with a newer edit is kept, and posting it asks for a shorter comment. */
const MAX_BODY = 2 * 4000 + 2
const revision = (value: unknown) => typeof value === 'string' && /^(|0|[1-9][0-9]{0,19})$/.test(value)

function parse(raw: string | null): (StoredCommentDraft & { operationId?: unknown }) | null {
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const { body, quote, operationId } = value as Record<string, unknown>
    if (typeof body !== 'string' || body.length > MAX_BODY || !quote || typeof quote !== 'object') return null
    const { text, bodyRevision, confirmedFor } = quote as Record<string, unknown>
    if (typeof text !== 'string' || text.length > 600 || !revision(bodyRevision) || !revision(confirmedFor)) return null
    return { body, quote: { text, bodyRevision: bodyRevision as string, confirmedFor: confirmedFor as string }, operationId }
}
export function readCommentDraft(scope: CommentDraftScope): StoredCommentDraft | null {
    try { const draft = parse(sessionStorage.getItem(key(scope))); return draft && { body: draft.body, quote: draft.quote } } catch { return null }
}
export function writeCommentDraft(scope: CommentDraftScope, draft: StoredCommentDraft): void {
    try {
        if (!draft.body && !draft.quote.text) sessionStorage.removeItem(key(scope))
        else sessionStorage.setItem(key(scope), JSON.stringify({ body: draft.body, quote: draft.quote }))
    } catch { /* Storage refused: the text stays in memory and the window asks before closing. */ }
}
/** An explicit disconnect forgets every unsent comment kept in this tab, for every account. */
export function clearCommentDrafts(): void {
    try {
        const keys: string[] = []
        held.clear()
        for (let i = 0; i < sessionStorage.length; i++) { const name = sessionStorage.key(i); if (name?.startsWith(PREFIX) || name?.startsWith(SENT)) keys.push(name) }
        for (const name of keys) sessionStorage.removeItem(name)
    } catch { /* Storage unavailable: nothing was kept there. */ }
}

/** What a composer holds; the reply target only lives in this page. */
export type HeldComment<P = unknown> = StoredCommentDraft & { parent?: P | null }
/** The hex SHA-256 digests a comment receipt records for its body and quote. */
export interface CommentDigests { bodySha256: string; anchorSha256: string }
export type CommentTextEvent = { scope: CommentDraftScope } & ({ kind: 'sent'; draft: HeldComment } | { kind: 'returned'; draft: HeldComment } | { kind: 'posted'; digests: CommentDigests })
export const commentDigest = (text: string) => bytesToHex(sha256(new TextEncoder().encode(text)))
/** Whether `draft` is the comment these digests describe. */
export const isPostedComment = (draft: StoredCommentDraft, digests: CommentDigests) =>
    !!draft.body && commentDigest(draft.body) === digests.bodySha256 && commentDigest(draft.quote.text) === digests.anchorSha256
/** Returned text first, then anything written meanwhile; a quote chosen meanwhile is kept. */
export function mergeReturned(current: StoredCommentDraft | null, returned: StoredCommentDraft): StoredCommentDraft {
    const body = !current?.body || current.body === returned.body ? returned.body : `${returned.body}\n\n${current.body}`
    return { body, quote: current?.quote.text ? current.quote : returned.quote }
}
const NO_QUOTE: StoredCommentDraft['quote'] = { text: '', bodyRevision: '', confirmedFor: '' }
const sentKey = (scope: CommentDraftScope) => SENT + key(scope).slice(PREFIX.length)
/** Comments sent from this page and still waiting for their outcome, per note scope. A reload forgets them. */
const held = new Map<string, HeldComment & { operationId: string }>()
const listeners = new Set<(event: CommentTextEvent) => void>()
const same = (a: CommentDraftScope, b: CommentDraftScope) => a.chainId === b.chainId && a.owner === b.owner && a.noteId === b.noteId
/** Every composer for this note in this tab learns when its text was sent, posted or given back. */
export function subscribeCommentText(scope: CommentDraftScope, listener: (event: CommentTextEvent) => void): () => void {
    const scoped = (event: CommentTextEvent) => { if (same(event.scope, scope)) listener(event) }
    listeners.add(scoped)
    return () => { listeners.delete(scoped) }
}
const emit = (event: CommentTextEvent) => { for (const listener of [...listeners]) listener(event) }
function dropSent(scope: CommentDraftScope) { try { sessionStorage.removeItem(sentKey(scope)) } catch { /* nothing was kept */ } }
function release(scope: CommentDraftScope, operationId: string) {
    const mine = held.get(key(scope))
    if (mine?.operationId !== operationId) return null
    held.delete(key(scope)); dropSent(scope)
    return mine
}
/** The wallet sent it: the text leaves every composer for the note until the outcome is known. */
export function holdSentComment(scope: CommentDraftScope, operationId: string, sent: HeldComment): void {
    held.set(key(scope), { ...sent, operationId })
    try { sessionStorage.setItem(sentKey(scope), JSON.stringify({ body: sent.body, quote: sent.quote, operationId })) } catch { /* held in memory */ }
    const stored = readCommentDraft(scope)
    if (stored?.body === sent.body) writeCommentDraft(scope, { body: '', quote: stored.quote.text === sent.quote.text ? NO_QUOTE : stored.quote })
    emit({ scope, kind: 'sent', draft: sent })
}
/**
 * The chain shows this comment: every composer and the stored copy holding it (same body and quote digests) let it go,
 * also when it was confirmed by checking a receipt in another composer.
 */
export function commentPosted(scope: CommentDraftScope, digests: CommentDigests, operationId?: string): void {
    if (operationId) release(scope, operationId)
    const stored = readCommentDraft(scope)
    if (stored && isPostedComment(stored, digests)) writeCommentDraft(scope, { body: '', quote: NO_QUOTE })
    emit({ scope, kind: 'posted', digests })
}
/** Outcome of a sent comment: posted, it is forgotten everywhere; otherwise it comes back, merged with any newer text. */
export function settleSentComment(scope: CommentDraftScope, operationId: string, sent: StoredCommentDraft, posted: boolean): void {
    if (posted) { commentPosted(scope, { bodySha256: commentDigest(sent.body), anchorSha256: commentDigest(sent.quote.text) }, operationId); return }
    const mine = release(scope, operationId)
    if (!mine) return
    writeCommentDraft(scope, mergeReturned(readCommentDraft(scope), mine))
    emit({ scope, kind: 'returned', draft: mine })
}
/** The unsent comment for a composer opening now. A held copy no request in this page will settle (the page was reloaded) comes back. */
export function takeCommentDraft(scope: CommentDraftScope): StoredCommentDraft | null {
    if (!held.has(key(scope))) {
        try {
            const orphan = parse(sessionStorage.getItem(sentKey(scope)))
            dropSent(scope)
            if (orphan) writeCommentDraft(scope, mergeReturned(readCommentDraft(scope), orphan))
        } catch { dropSent(scope) }
    }
    return readCommentDraft(scope)
}
