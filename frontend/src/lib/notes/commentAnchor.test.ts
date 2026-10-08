import { describe, expect, it } from 'vitest'
import { commentAnchorRevision, findCommentAnchor } from './commentAnchor'
function root(html: string, rendered = 'html') { const node = document.createElement('article'); node.dataset.rendered = rendered; node.innerHTML = html; return node }
describe('bounded rendered comment anchors', () => {
    it('matches rendered text across inline markup without matching Markdown syntax', () => {
        const node = root('<p>A <strong>bold</strong> quote.</p>')
        const match = findCommentAnchor(node, { quote: 'A bold quote.' })
        expect(match.status).toBe('present'); if (match.status === 'present') expect(match.range.toString()).toBe('A bold quote.')
        expect(findCommentAnchor(node, { quote: '**bold**' }).status).toBe('absent')
    })
    it('keeps duplicate and overlapping quotes ambiguous unless context identifies exactly one', () => {
        const node = root('<p>First quote end.</p><p>Other quote tail.</p>')
        expect(findCommentAnchor(node, { quote: 'quote' }).status).toBe('ambiguous')
        const match = findCommentAnchor(node, { quote: 'quote', prefix: 'Other ', suffix: ' tail.' })
        expect(match.status).toBe('present'); if (match.status === 'present') expect(match.range.startContainer.parentElement?.textContent).toBe('Other quote tail.')
        expect(findCommentAnchor(node, { quote: 'quote', prefix: 'missing' }).status).toBe('ambiguous')
        expect(findCommentAnchor(root('<p>aaaa</p>'), { quote: 'aaa' }).status).toBe('ambiguous')
    })
    it('preserves a unique quote after surrounding edits but never crosses block boundaries', () => {
        expect(findCommentAnchor(root('<p>Changed before quote changed after</p>'), { quote: 'quote', prefix: 'old', suffix: 'old' }).status).toBe('present')
        expect(findCommentAnchor(root('<p>First</p><p>Second</p>'), { quote: 'FirstSecond' }).status).toBe('absent')
        expect(findCommentAnchor(root('<p>removed</p>'), { quote: 'quote' }).status).toBe('absent')
    })
    it('handles emoji, combining marks and RTL exactly without Unicode normalization guesses', () => {
        const match = findCommentAnchor(root('<p>😀 e\u0301 שלום</p>'), { quote: '😀 e\u0301 שלום' })
        expect(match.status).toBe('present'); if (match.status === 'present') expect(match.range.toString()).toBe('😀 e\u0301 שלום')
        expect(findCommentAnchor(root('<p>e\u0301</p>'), { quote: 'é' }).status).toBe('absent')
    })
    it('never reports location from raw Markdown fallback, loading, or missing preview', () => {
        for (const state of ['loading', 'text', '']) expect(findCommentAnchor(root('<pre>**quote**</pre>', state), { quote: 'quote' }).status).toBe('unchecked')
        expect(findCommentAnchor(null, { quote: 'quote' }).status).toBe('unchecked')
        expect(findCommentAnchor(root('<p>anything</p>'), { quote: '' }).status).toBe('none')
    })
    it('bounds UTF-8 text, node traversal and selector sizes before searching', () => {
        expect(findCommentAnchor(root(`<p>${'x'.repeat(131072)}</p>`), { quote: 'z' }).status).toBe('absent')
        expect(findCommentAnchor(root(`<p>${'😀'.repeat(32769)}</p>`), { quote: '😀' }).status).toBe('unchecked')
        expect(findCommentAnchor(root('<i></i>'.repeat(24001)), { quote: 'z' }).status).toBe('unchecked')
        expect(findCommentAnchor(root('<p>quote</p>'), { quote: 'x'.repeat(1121) }).status).toBe('unchecked')
    })
    it('compares uint64 revisions without numeric precision loss or inventing older versions', () => {
        expect(commentAnchorRevision('18446744073709551614', '18446744073709551615')).toBe('earlier')
        expect(commentAnchorRevision('2', '2')).toBe('current')
        for (const value of ['0', '01', '-1', '18446744073709551616']) expect(commentAnchorRevision(value, '2')).toBe('unchecked')
        expect(commentAnchorRevision('3', '2')).toBe('unchecked')
    })
})
