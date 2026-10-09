import { StrictMode, useEffect, useState } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { NativeViewProps } from "../../native/types"
import type { OsWindow } from "../../shell/windows"
import { NotesStages } from "./NotesStages"
import { NotesSlot, NotesStageProvider } from "./stageRegistry"

const section = "0123456789abcdef0123456789abcdef"
const win = { id: "w1", key: `notes:${section}`, min: false, target: { kind: "app", app: "notes", section } } as unknown as OsWindow
const session = { address: "account-a", network: { chainId: "test-chain" } } as NativeViewProps["session"]
const actions = { open: vi.fn(), openApp: vi.fn(), toast: vi.fn(), close: vi.fn(), focus: vi.fn() }
const base: NativeViewProps = { ...actions, session, section, active: true, push: actions.open, fallback: null }

describe("stable Notes stages", () => {
    it("moves the same DOM/comment composer across layouts and detached parking, preserving pending public comments", () => {
        const cleanup = vi.fn(), mount = vi.fn()
        function App({ active }: NativeViewProps) {
            const [text, setText] = useState("")
            useEffect(() => { mount(); return cleanup }, [])
            return <input aria-label="public comment" value={text} data-active={active} onChange={event => setText(event.target.value)} />
        }
        function Harness({ phone, parked = false }: { phone: boolean; parked?: boolean }) {
            return <NotesStageProvider>
                {parked ? null : phone ? <section data-testid="phone"><NotesSlot {...base} /></section> : <main data-testid="desktop"><NotesSlot {...base} /></main>}
                <NotesStages {...actions} session={session} wins={[win]} activeWindowId={parked ? null : win.id} App={App} />
            </NotesStageProvider>
        }
        const view = render(<Harness phone={false} />)
        const editor = screen.getByRole("textbox")
        const container = editor.parentElement!.parentElement
        fireEvent.change(editor, { target: { value: "Unsent public comment" } })
        view.rerender(<Harness phone />)
        expect(screen.getByRole("textbox")).toBe(editor)
        expect(editor.parentElement!.parentElement).toBe(container)
        expect(screen.getByTestId("phone").contains(editor)).toBe(true)
        view.rerender(<Harness phone parked />)
        expect(editor.isConnected).toBe(false)
        expect(cleanup).not.toHaveBeenCalled()
        view.rerender(<Harness phone={false} />)
        expect(screen.getByRole("textbox")).toBe(editor)
        expect(editor).toHaveValue("Unsent public comment")
        expect(screen.getByTestId("desktop").contains(editor)).toBe(true)
        expect(mount).toHaveBeenCalledTimes(1)
        view.unmount()
        expect(cleanup).toHaveBeenCalledTimes(1)
        expect(container!.childNodes).toHaveLength(0)
    })

    it("destroys state on close, account and chain boundaries, including StrictMode cleanup", () => {
        const cleanup = vi.fn()
        function App() {
            const [text, setText] = useState("")
            useEffect(() => cleanup, [])
            return <input aria-label="public comment" value={text} onChange={event => setText(event.target.value)} />
        }
        function Harness({ current = session, closed = false }: { current?: typeof session; closed?: boolean }) {
            return <StrictMode><NotesStageProvider>
                {!closed && <NotesSlot {...base} session={current} />}
                <NotesStages {...actions} session={current} wins={closed ? [] : [win]} App={App} />
            </NotesStageProvider></StrictMode>
        }
        const view = render(<Harness />)
        const old = screen.getByRole("textbox")
        fireEvent.change(old, { target: { value: "Account A comment" } })
        view.rerender(<Harness current={{ ...session, address: "account-b" }} />)
        expect(old.isConnected).toBe(false)
        expect(screen.getByRole("textbox")).toHaveValue("")
        const other = screen.getByRole("textbox")
        fireEvent.change(other, { target: { value: "Chain 1 comment" } })
        view.rerender(<Harness current={{ ...session, network: { ...session.network, chainId: "chain-2" } }} />)
        expect(other.isConnected).toBe(false)
        expect(screen.getByRole("textbox")).toHaveValue("")
        const last = screen.getByRole("textbox")
        view.rerender(<Harness closed />)
        expect(last.isConnected).toBe(false)
        expect(last.closest(".os-notes-stage")).toBeNull()
        expect(cleanup).toHaveBeenCalled()
        view.rerender(<Harness />)
        expect(screen.getByRole("textbox")).toHaveValue("")
    })

    it("restores window focus for portal interactions and forwards native actions", () => {
        actions.focus.mockClear()
        const push = vi.fn(), captured: NativeViewProps[] = []
        function App(props: NativeViewProps) { captured.push(props); return <input aria-label="public comment" /> }
        const view = render(<NotesStageProvider>
            <NotesSlot {...base} />
            <NotesStages {...actions} session={session} wins={[win]} App={App} push={push} activeWindowId={null} />
        </NotesStageProvider>)
        fireEvent.pointerDown(screen.getByRole("textbox"))
        fireEvent.focus(screen.getByRole("textbox"))
        expect(actions.focus).toHaveBeenCalledWith(win.id)
        expect(captured.at(-1)!.push).toBe(push)
        expect(captured.at(-1)!.active).toBe(false)
        captured.at(-1)!.close()
        expect(actions.close).toHaveBeenCalledWith(win.id)
        view.unmount()
    })
})
