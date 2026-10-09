import { Suspense, useLayoutEffect, useState, type ComponentType } from "react"
import { createPortal } from "react-dom"
import type { NativeViewProps } from "../../native/types"
import type { OsWindow } from "../../shell/windows"
import { WindowError } from "../../shell/WindowError"
import { notesStageKey, useNotesStageRegistry } from "./stageRegistry"

type Props = Pick<NativeViewProps, "session" | "open" | "openApp" | "toast"> & {
    wins: readonly OsWindow[]
    activeWindowId?: string | null
    App: ComponentType<NativeViewProps>
    push?: NativeViewProps["push"]
    close: (id: string) => void
    focus: (id: string) => void
}

/** Mount outside the desktop/phone branch. Feature gating belongs to the caller. */
export function NotesStages({ wins, activeWindowId, App, close, focus, push, ...actions }: Props) {
    return wins.filter(win => win.key === "app:notes" || win.key.startsWith("notes:")).map(win => {
        const section = win.target?.kind === "app" ? win.target.section : null
        const props: NativeViewProps = {
            ...actions, section, active: !win.min && win.id === activeWindowId,
            close: () => close(win.id), push: push ?? actions.open, fallback: null,
        }
        return <NotesStage key={`${notesStageKey(props)}:${win.id}`} App={App} view={props} activate={() => { if (!win.min && !props.active) focus(win.id) }} />
    })
}

function NotesStage({ App, view, activate }: { App: ComponentType<NativeViewProps>; view: NativeViewProps; activate(): void }) {
    const registry = useNotesStageRegistry()
    // Never change this portal target, even when its parent slot changes.
    const [container] = useState(() => {
        const element = document.createElement("div")
        element.className = "os-notes-stage"
        element.style.height = "100%"
        element.style.minHeight = "0"
        return element
    })
    const key = notesStageKey(view)
    useLayoutEffect(() => registry?.register(key, "container", container), [registry, key, container])
    // Portal events follow this React tree, not the WindowFrame owning the DOM slot.
    return registry ? createPortal(<div style={{ height: "100%", minHeight: 0 }} onPointerDownCapture={activate} onFocusCapture={activate}>
        <WindowError resetKey={key}><Suspense fallback={<p role="status">Loading Notes…</p>}><App {...view} /></Suspense></WindowError>
    </div>, container) : null
}
