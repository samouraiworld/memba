/**
 * An unsent comment on a public note, kept in this tab's session storage so a lock, an
 * account or network switch, or a reload does not lose it. Comments are public text on a
 * public note; private note content never goes here, and nothing goes to localStorage.
 * Cleared once the comment is posted or emptied.
 *
 * A comment the wallet has sent is held aside until its outcome, and every composer for the note in this
 * tab (open now or opened later) lets it go: a posted comment is never offered again, so it cannot be paid
 * for twice. Any other outcome gives the text back (its receipt still blocks a resend until checked).
 */
export interface CommentDraftScope { chainId: string; owner: string; noteId: string }
export interface StoredCommentDraft { body: string; quote: { text: string; bodyRevision: string; confirmedFor: string } }

const PREFIX = 'memba_notes_comment:v1:', SENT = 'memba_notes_comment_sent:v1:'
const key = ({ chainId, owner, noteId }: CommentDraftScope) => `${PREFIX}${chainId}:${owner}:${noteId}`
const revision = (value: unknown) => typeof value === 'string' && /^(|0|[1-9][0-9]{0,19})$/.test(value)

function parse(raw: string | null): (StoredCommentDraft & { operationId?: unknown }) | null {
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const { body, quote, operationId } = value as Record<string, unknown>
    if (typeof body !== 'string' || body.length > 4000 || !quote || typeof quote !== 'object') return null
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
export interface CommentTextEvent { scope: CommentDraftScope; kind: 'sent' | 'posted' | 'returned'; draft: HeldComment }
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
/** The stored copy stops holding `sent`; a newer edit is kept. */
function forget(scope: CommentDraftScope, sent: StoredCommentDraft) {
    const stored = readCommentDraft(scope)
    if (stored?.body === sent.body) writeCommentDraft(scope, { body: '', quote: stored.quote.text === sent.quote.text ? NO_QUOTE : stored.quote })
}
function dropSent(scope: CommentDraftScope) { try { sessionStorage.removeItem(sentKey(scope)) } catch { /* nothing was kept */ } }
/** The wallet sent it: the text leaves every composer for the note until the outcome is known. */
export function holdSentComment(scope: CommentDraftScope, operationId: string, sent: HeldComment): void {
    held.set(key(scope), { ...sent, operationId })
    try { sessionStorage.setItem(sentKey(scope), JSON.stringify({ body: sent.body, quote: sent.quote, operationId })) } catch { /* held in memory */ }
    forget(scope, sent); emit({ scope, kind: 'sent', draft: sent })
}
/** A posted comment is forgotten everywhere; a sent one that was not confirmed comes back to an empty composer. */
export function settleSentComment(scope: CommentDraftScope, operationId: string, sent: StoredCommentDraft, posted: boolean): void {
    const mine = held.get(key(scope))
    if (mine?.operationId === operationId) { held.delete(key(scope)); dropSent(scope) }
    if (posted) { forget(scope, sent); emit({ scope, kind: 'posted', draft: sent }) }
    else if (mine?.operationId === operationId) {
        if (!readCommentDraft(scope)) writeCommentDraft(scope, { body: mine.body, quote: mine.quote })
        emit({ scope, kind: 'returned', draft: mine })
    }
}
/** The unsent comment for a composer opening now. A held copy no request in this page will settle (the page was reloaded) comes back. */
export function takeCommentDraft(scope: CommentDraftScope): StoredCommentDraft | null {
    if (!held.has(key(scope))) {
        try {
            const orphan = parse(sessionStorage.getItem(sentKey(scope)))
            dropSent(scope)
            if (orphan && !readCommentDraft(scope)) writeCommentDraft(scope, { body: orphan.body, quote: orphan.quote })
        } catch { dropSent(scope) }
    }
    return readCommentDraft(scope)
}
