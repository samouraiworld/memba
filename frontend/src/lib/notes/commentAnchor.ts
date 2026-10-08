/** DOM text only. Never interpret Markdown source or inject a quote as HTML. */
export interface CommentQuote { quote: string; prefix?: string; suffix?: string }
export type CommentAnchorMatch = { status: 'none' | 'absent' | 'ambiguous' | 'unchecked' } | { status: 'present'; range: Range }
const MAX_BYTES = 131072, MAX_NODES = 24000, encoder = new TextEncoder()
const BLOCK = 'p,h1,h2,h3,h4,h5,h6,li,td,th,pre,blockquote'
type Segment = { node: Text; start: number }
type Block = { element: Element; text: string; segments: Segment[] }

function boundedBlocks(root: HTMLElement): Block[] | null {
    if (root.dataset.rendered !== 'html') return null
    const walk = root.ownerDocument.createTreeWalker(root, 1 | 4), blocks: Block[] = []
    let node: Node | null, bytes = 0, count = 0
    while ((node = walk.nextNode())) {
        if (++count > MAX_NODES) return null
        if (node.nodeType !== 3) continue
        const text = node as Text, parent = text.parentElement
        if (!parent || parent.closest('script,style,textarea')) continue
        if (text.data.length > MAX_BYTES || (bytes += encoder.encode(text.data).length) > MAX_BYTES) return null
        const nearest = parent.closest(BLOCK), element = nearest && root.contains(nearest) ? nearest : root
        let block = blocks.at(-1)
        if (!block || block.element !== element) { block = { element, text: '', segments: [] }; blocks.push(block) }
        block.segments.push({ node: text, start: block.text.length }); block.text += text.data
    }
    return blocks
}
function locate(block: Block, start: number, length: number): Range {
    const first = block.segments.find(segment => start < segment.start + segment.node.length)!
    const end = start + length, last = block.segments.find(segment => end <= segment.start + segment.node.length)!
    const range = first.node.ownerDocument.createRange()
    range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start)
    return range
}
/** Exact matches stay valid across surrounding edits; context disambiguates duplicates only. */
export function findCommentAnchor(root: HTMLElement | null | undefined, anchor: CommentQuote): CommentAnchorMatch {
    const { quote, prefix = '', suffix = '' } = anchor
    if (!quote) return { status: 'none' }
    if (!root || quote.length > 1120 || prefix.length > 128 || suffix.length > 128
        || encoder.encode(quote).length > 1120 || encoder.encode(prefix).length > 128 || encoder.encode(suffix).length > 128) return { status: 'unchecked' }
    const blocks = boundedBlocks(root)
    if (!blocks) return { status: 'unchecked' }
    let count = 0, contextualCount = 0, only: Range | undefined, contextual: Range | undefined
    for (const block of blocks) {
        let from = 0, index: number
        while ((index = block.text.indexOf(quote, from)) !== -1) {
            if (++count === 1) only = locate(block, index, quote.length)
            if ((prefix || suffix) && block.text.slice(Math.max(0, index - prefix.length), index) === prefix && block.text.slice(index + quote.length, index + quote.length + suffix.length) === suffix) {
                if (++contextualCount === 1) contextual = locate(block, index, quote.length)
            }
            from = index + 1 // Include overlapping occurrences; never assume a repeated quote is unique.
        }
    }
    if (count === 1) return { status: 'present', range: only! }
    if (count > 1 && contextualCount === 1) return { status: 'present', range: contextual! }
    return { status: count ? 'ambiguous' : 'absent' }
}
export function commentAnchorRevision(anchorRevision: string, currentRevision: string): 'current' | 'earlier' | 'unchecked' {
    const valid = (value: string) => /^[1-9]\d{0,19}$/.test(value) && BigInt(value) <= 0xffffffffffffffffn
    if (!valid(anchorRevision) || !valid(currentRevision) || BigInt(anchorRevision) > BigInt(currentRevision)) return 'unchecked'
    return anchorRevision === currentRevision ? 'current' : 'earlier'
}
