import { useEffect, useRef } from "react"
import { Annotation, EditorState } from "@codemirror/state"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { EditorView, basicSetup } from "codemirror"
import { go } from "@codemirror/lang-go"
import { tags } from "@lezer/highlight"

/** Gno follows Go closely enough for its highlighting and indentation rules. */
export const MAX_SOURCE_BYTES = 32_768
const externalSync = Annotation.define<boolean>()

const gnoHighlight = HighlightStyle.define([
    { tag: tags.keyword, color: "var(--os-code-keyword)" },
    { tag: [tags.atom, tags.bool, tags.number, tags.null], color: "var(--os-code-value)" },
    { tag: [tags.string, tags.character, tags.regexp], color: "var(--os-code-string)" },
    { tag: tags.comment, color: "var(--os-code-comment)" },
    { tag: [tags.typeName, tags.namespace, tags.className], color: "var(--os-code-type)" },
    { tag: [tags.definition(tags.variableName), tags.function(tags.variableName), tags.propertyName], color: "var(--os-code-value)" },
])

export function CodeEditor({ value, onChange, onLimit, invalid, descriptionId }: {
    value: string; onChange: (code: string) => void; onLimit: () => void; invalid: boolean; descriptionId: string
}) {
    const host = useRef<HTMLDivElement>(null)
    const view = useRef<EditorView | null>(null)
    const change = useRef(onChange)
    const limit = useRef(onLimit)
    const beforeDeletion = useRef<{ text: string; at: number } | null>(null)

    useEffect(() => { change.current = onChange }, [onChange])
    useEffect(() => { limit.current = onLimit }, [onLimit])

    useEffect(() => {
        if (!host.current) return
        const editor = new EditorView({
            parent: host.current,
            state: EditorState.create({
                doc: value,
                extensions: [basicSetup, go(), syntaxHighlighting(gnoHighlight), EditorState.transactionFilter.of((transaction) => {
                    if (!transaction.docChanged) return transaction
                    if (transaction.annotation(externalSync)) {
                        beforeDeletion.current = null
                        return transaction
                    }
                    if (new TextEncoder().encode(transaction.newDoc.toString()).length > MAX_SOURCE_BYTES) {
                        const deletion = beforeDeletion.current
                        const restore = deletion && performance.now() - deletion.at < 50 ? deletion.text : null
                        beforeDeletion.current = null
                        queueMicrotask(() => limit.current())
                        // Firefox may issue select-all replacement as a deletion followed by insertion.
                        // Restore the pre-deletion document if its insertion is rejected.
                        return restore === null ? [] : [{ changes: { from: 0, to: transaction.startState.doc.length, insert: restore } }]
                    }
                    beforeDeletion.current = transaction.newDoc.length < transaction.startState.doc.length
                        ? { text: transaction.startState.doc.toString(), at: performance.now() } : null
                    return transaction
                }), EditorView.lineWrapping, EditorView.contentAttributes.of({
                    "aria-label": "Gno source editor", "aria-describedby": descriptionId, "aria-invalid": String(invalid),
                }), EditorView.updateListener.of((update) => {
                    if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(externalSync)))
                        change.current(update.state.doc.toString())
                })],
            }),
        })
        view.current = editor
        return () => { view.current = null; editor.destroy() }
    // The external value is synchronised below; remounting on each keystroke loses selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        view.current?.contentDOM.setAttribute("aria-describedby", descriptionId)
        view.current?.contentDOM.setAttribute("aria-invalid", String(invalid))
    }, [descriptionId, invalid])

    useEffect(() => {
        const editor = view.current
        if (!editor || editor.state.doc.toString() === value) return
        beforeDeletion.current = null
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, annotations: externalSync.of(true) })
    }, [value])

    return <div className="os-terminal-editor" ref={host} role="group" aria-label="Gno source editor" />
}
