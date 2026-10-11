/** The real Shell desktop: note shortcut look, its right-click menu and the Notes window's desk button. */
import { useState, type ReactNode } from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { Shell } from "./Shell"
import type { OsSession } from "./useOsSession"
import { addItem, sameItem, type DeskItem } from "./desk"
import type { OsWindow } from "./windows"
import { writeNoteShortcuts } from "./noteShortcuts"
import { NoteDeskButton } from "../apps/notes/NoteDeskButton"

const pinned = "ab".repeat(16), other = "cd".repeat(16), secret = "ef".repeat(16)
const fixture = vi.hoisted(() => ({ session: null as unknown as OsSession, removed: [] as string[] }))
vi.mock("./useOsSession", () => ({ useOsSession: () => fixture.session }))
vi.mock("../../lib/chain/flag", () => ({ EVM_ENABLED: false }))
vi.mock("../../lib/notes/config", () => ({ NOTES_ENABLED: true, NOTE_ID: /^[0-9a-f]{32}$/, notesDeployment: () => null }))
vi.mock("../preferences", () => ({ readSkipIntro: () => true, useLiveWidget: () => false }))
vi.mock("../boot/boot", () => ({ shouldBoot: () => false, bootLines: () => [] }))
vi.mock("./useDesk", () => ({ useDesk: function useFakeDesk() {
    const [items, setItems] = useState<DeskItem[]>([{ ty: "note", ref: "ab".repeat(16), c: 0, r: 0 }, { ty: "note", ref: "ef".repeat(16), c: 0, r: 1 }])
    return { items, noteLabels: {}, scopeKey: "scope", error: null, resetFromStorage: () => {}, move: () => {}, tidy: () => {},
        isPinned: (item: Pick<DeskItem, "ty" | "ref">) => items.some((it) => sameItem(it, item)),
        pin: (item: Pick<DeskItem, "ty" | "ref">) => setItems((list) => addItem(list, item)),
        unpin: (index: number) => setItems((list) => { fixture.removed.push(list[index].ref); return list.filter((_, i) => i !== index) }) }
} }))
vi.mock("./ConnectModal", () => ({ ConnectModal: () => null }))
vi.mock("../evm/EvmConnectModal", () => ({ EvmConnectModal: () => null }))
vi.mock("./Dock", () => ({ Dock: () => null }))
vi.mock("./Launcher", () => ({ Launcher: () => null }))
vi.mock("./MenuBar", () => ({ MenuBar: () => null }))
vi.mock("../community/CommunityNews", () => ({ CommunityNewsPrompt: () => null }))
vi.mock("../apps/live/LiveProvider", () => ({ LiveActivityProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock("../apps/meet/MeetStage", () => ({ MeetStage: () => null }))
vi.mock("../apps/notes/stageRegistry", () => ({ NotesStageProvider: ({ children }: { children: ReactNode }) => children }))
// Stands in for an open Notes window showing `other`: the real button, through the Shell's desk.
vi.mock("../apps/notes/NotesStages", () => ({ NotesStages: () => <section aria-label="Notes window"><NoteDeskButton noteId={"cd".repeat(16)} /></section> }))
vi.mock("./WindowFrame", () => ({ WindowFrame: ({ win }: { win: OsWindow }) => <output data-testid={win.key} data-section={win.target?.kind === "app" ? win.target.section ?? "" : ""}>{win.title}</output> }))

function member(): OsSession {
    return { status: "member", address: "g1alpha", walletAddress: "g1alpha", walletChainId: "gnoland-1",
        network: { key: "mainnet", chainId: "gnoland-1", family: "gno", isTestnet: false }, layout: { auth: null },
        stage: null, openConnect: vi.fn(), disconnect: vi.fn(), wake: vi.fn() } as unknown as OsSession
}
function mountShell() {
    const query = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={query}><MemoryRouter initialEntries={["/os"]}><Shell /></MemoryRouter></QueryClientProvider>)
}
const desktop = () => screen.getByRole("main", { name: "Desktop" })

beforeEach(() => {
    localStorage.clear(); fixture.session = member(); fixture.removed = []
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("Unexpected network request"))))
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    writeNoteShortcuts("gnoland-1", "g1alpha", { [pinned]: { title: "Sushi", private: false, missing: false }, [secret]: { title: null, private: true, missing: false } }, [pinned, secret])
})
afterEach(() => { vi.unstubAllGlobals() })

it("labels note shortcuts with their known title, or Note with a lock for a private note", () => {
    mountShell()
    const sushi = within(desktop()).getByRole("button", { name: "Note shortcut: Sushi" })
    expect(sushi.querySelector(".os-badge2-note:not([data-private])")).not.toBeNull()
    const locked = within(desktop()).getByRole("button", { name: "Private note shortcut" })
    expect(locked).toHaveTextContent("Note")
    expect(locked.querySelector(".os-badge2-note[data-private]")).not.toBeNull()
})

it("opens the note in the Notes window from its shortcut", () => {
    mountShell()
    fireEvent.click(within(desktop()).getByRole("button", { name: "Note shortcut: Sushi" }))
    // One Notes window: the shortcut shows its note there.
    expect(screen.getByTestId("app:notes")).toHaveAttribute("data-section", pinned)
})

it("right-click offers Open and Remove from Desktop, and removing keeps the note", () => {
    mountShell()
    fireEvent.contextMenu(within(desktop()).getByRole("button", { name: "Note shortcut: Sushi" }))
    const menu = screen.getByRole("menu")
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Open", "Remove from Desktop"])
    expect(within(menu).getByText("The note itself is not deleted.")).toBeVisible()
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Remove from Desktop" }))
    expect(fixture.removed).toEqual([pinned])
    expect(within(desktop()).queryByRole("button", { name: "Note shortcut: Sushi" })).toBeNull()
    expect(localStorage.getItem("memba_os_note_shortcuts:v1:gnoland-1:g1alpha")).not.toContain("Sushi")
    expect(globalThis.fetch).not.toHaveBeenCalled()
})

it("adds and removes the open note from the Notes window through the same desk", () => {
    mountShell()
    const notes = screen.getByRole("region", { name: "Notes window" })
    fireEvent.click(within(notes).getByRole("button", { name: "Add to Desktop" }))
    expect(within(desktop()).getByRole("button", { name: "Note shortcut" })).toBeVisible()
    fireEvent.click(within(notes).getByRole("button", { name: "Remove from Desktop" }))
    expect(fixture.removed).toEqual([other])
    expect(within(notes).getByRole("button", { name: "Add to Desktop" })).toBeVisible()
})
