import { useEffect, useState } from 'react'
import { commentAnchorRevision, findCommentAnchor, type CommentQuote } from '../../../lib/notes/commentAnchor'

export interface AnchorQuoteProps extends CommentQuote { bodyRevision: string; currentBodyRevision: string; previewRoot?: HTMLElement | null }
/** No DOM identifiers contain private text. Unavailable/fallback rendering never proves orphanhood. */
export function AnchorQuote(props: AnchorQuoteProps) {
    const { quote, prefix = '', suffix = '', bodyRevision, currentBodyRevision, previewRoot } = props
    const [result, setResult] = useState<{ root: HTMLElement | null | undefined; key: string; status: string } | null>(null)
    const key = JSON.stringify([quote, prefix, suffix, bodyRevision, currentBodyRevision])
    const revision = commentAnchorRevision(bodyRevision, currentBodyRevision)
    useEffect(() => {
        let stopped = false, timer: ReturnType<typeof setTimeout> | undefined
        const update = () => { if (!stopped) setResult({ root: previewRoot, key, status: findCommentAnchor(previewRoot, { quote, prefix, suffix }).status }) }
        const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(update, 60) })
        if (previewRoot) observer.observe(previewRoot, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-rendered'] })
        timer = setTimeout(update, 0)
        return () => { stopped = true; clearTimeout(timer); observer.disconnect() }
    }, [previewRoot, quote, prefix, suffix, key])
    if (!quote) return null
    const status = revision !== 'unchecked' && result?.key === key && result.root === previewRoot ? result.status : 'unchecked'
    const explanation = status === 'present' ? 'Quote found in the current text.' : status === 'absent' ? 'Quote not found in the current text. The reference is kept with this comment.'
        : status === 'ambiguous' ? 'Quote occurs more than once; its location is ambiguous.' : 'Quote location has not been checked against the rendered text.'
    function showQuote() {
        // The DOM may have changed since the last observer callback. Never use an old Range.
        const match = findCommentAnchor(previewRoot, { quote, prefix, suffix })
        setResult({ root: previewRoot, key, status: match.status })
        if (match.status !== 'present') return
        const selection = previewRoot?.ownerDocument.defaultView?.getSelection()
        const target = match.range.startContainer.parentElement
        if (target) {
            const previous = target.getAttribute('tabindex')
            target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true })
            target.addEventListener('blur', () => { if (previous === null) target.removeAttribute('tabindex'); else target.setAttribute('tabindex', previous) }, { once: true })
            target.scrollIntoView?.({ block: 'center', behavior: 'auto' })
        }
        // Focusing may collapse a browser selection, so apply the Range afterwards.
        selection?.removeAllRanges(); selection?.addRange(match.range)
    }
    return <figure className="os-notes-anchor">
        <blockquote style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{quote}</blockquote>
        <figcaption><span role="status">{revision === 'earlier' ? 'Comment on an earlier body revision. ' : ''}{explanation}</span>
            {status === 'present' && <button className="os-btn os-quiet" onClick={showQuote}>Show quoted text</button>}
        </figcaption>
    </figure>
}
