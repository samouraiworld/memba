import { useEffect, useRef } from "react"
import { EditorState } from "@codemirror/state"
import { EditorView, basicSetup } from "codemirror"
import { go } from "@codemirror/lang-go"

/** Gno follows Go closely enough for its highlighting and indentation rules. */
export const MAX_SOURCE_BYTES = 32_768

export function CodeEditor({ value, onChange, onLimit }: { value: string; onChange: (code: string) => void; onLimit: () => void }) {
    const host = useRef<HTMLDivElement>(null)
    const view = useRef<EditorView | null>(null)
    const change = useRef(onChange)
    const limit = useRef(onLimit)

    useEffect(() => { change.current = onChange }, [onChange])
    useEffect(() => { limit.current = onLimit }, [onLimit])

    useEffect(() => {
        if (!host.current) return
        const editor = new EditorView({
            parent: host.current,
            state: EditorState.create({
                doc: value,
                extensions: [basicSetup, go(), EditorState.transactionFilter.of((transaction) => {
                    if (transaction.docChanged && new TextEncoder().encode(transaction.newDoc.toString()).length > MAX_SOURCE_BYTES) {
                        limit.current()
                        return []
                    }
                    return transaction
                }), EditorView.lineWrapping, EditorView.contentAttributes.of({ "aria-label": "Gno source editor" }), EditorView.updateListener.of((update) => {
                    if (update.docChanged) change.current(update.state.doc.toString())
                })],
            }),
        })
        view.current = editor
        return () => { view.current = null; editor.destroy() }
    // The external value is synchronised below; remounting on each keystroke loses selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        const editor = view.current
        if (!editor || editor.state.doc.toString() === value) return
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
    }, [value])

    return <div className="os-terminal-editor" ref={host} role="group" aria-label="Gno source editor" />
}
