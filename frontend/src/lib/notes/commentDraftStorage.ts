/**
 * An unsent comment on a public note, kept in this tab's session storage so a lock, an
 * account or network switch, or a reload does not lose it. Comments are public text on a
 * public note; private note content never goes here, and nothing goes to localStorage.
 * Cleared once the comment is posted or emptied.
 */
export interface CommentDraftScope { chainId: string; owner: string; noteId: string }
export interface StoredCommentDraft { body: string; quote: { text: string; bodyRevision: string; confirmedFor: string } }

const PREFIX = 'memba_notes_comment:v1:'
const key = ({ chainId, owner, noteId }: CommentDraftScope) => `${PREFIX}${chainId}:${owner}:${noteId}`
const revision = (value: unknown) => typeof value === 'string' && /^(|0|[1-9][0-9]{0,19})$/.test(value)

export function readCommentDraft(scope: CommentDraftScope): StoredCommentDraft | null {
    try {
        const raw = sessionStorage.getItem(key(scope))
        if (raw === null) return null
        const value: unknown = JSON.parse(raw)
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null
        const { body, quote } = value as Record<string, unknown>
        if (typeof body !== 'string' || body.length > 4000 || !quote || typeof quote !== 'object') return null
        const { text, bodyRevision, confirmedFor } = quote as Record<string, unknown>
        if (typeof text !== 'string' || text.length > 600 || !revision(bodyRevision) || !revision(confirmedFor)) return null
        return { body, quote: { text, bodyRevision: bodyRevision as string, confirmedFor: confirmedFor as string } }
    } catch { return null }
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
        for (let i = 0; i < sessionStorage.length; i++) { const name = sessionStorage.key(i); if (name?.startsWith(PREFIX)) keys.push(name) }
        for (const name of keys) sessionStorage.removeItem(name)
    } catch { /* Storage unavailable: nothing was kept there. */ }
}
