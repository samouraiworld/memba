/** The menu bar closes windows through the same unsaved-text guard as the title bar and ⌥W. */
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
import { registerCloseGuard } from "./closeGuards"

const pinned = "ab".repeat(16), secret = "ef".repeat(16)
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
vi.mock("./MenuBar", () => ({ MenuBar: (p: { wins: OsWindow[]; closeWin: (id: string) => void; closeAll: () => void; lock: () => void }) => <nav aria-label="Menu">
    <button onClick={() => p.wins.forEach((w) => p.closeWin(w.id))}>Close window</button>
    <button onClick={p.closeAll}>Close all</button><button onClick={p.lock}>Disconnect & lock</button></nav> }))
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

let unguard: (() => void) | null = null
afterEach(() => { unguard?.(); unguard = null })

for (const item of ["Close window", "Close all"]) {
    it(`${item} in the menu bar keeps a Notes window holding unsaved text`, () => {
        mountShell()
        fireEvent.click(within(desktop()).getByRole("button", { name: "Note shortcut: Sushi" }))
        expect(screen.getByTestId("app:notes")).toBeInTheDocument()
        unguard = registerCloseGuard("app:notes", () => false)
        fireEvent.click(within(screen.getByRole("navigation", { name: "Menu" })).getByRole("button", { name: item }))
        expect(screen.getByTestId("app:notes")).toBeInTheDocument()
        unguard(); unguard = null
        fireEvent.click(within(screen.getByRole("navigation", { name: "Menu" })).getByRole("button", { name: item }))
        expect(screen.queryByTestId("app:notes")).toBeNull()
    })
}

it("Disconnect & lock asks the same guards first: a refusal keeps the account and every window; once allowed, it locks", () => {
    mountShell()
    fireEvent.click(within(desktop()).getByRole("button", { name: "Note shortcut: Sushi" }))
    const ask = vi.fn(() => false)
    unguard = registerCloseGuard("app:notes", ask)
    fireEvent.click(within(screen.getByRole("navigation", { name: "Menu" })).getByRole("button", { name: "Disconnect & lock" }))
    expect(ask).toHaveBeenCalledOnce(); expect(fixture.session.disconnect).not.toHaveBeenCalled()
    expect(screen.getByTestId("app:notes")).toBeInTheDocument()
    ask.mockReturnValue(true)
    fireEvent.click(within(screen.getByRole("navigation", { name: "Menu" })).getByRole("button", { name: "Disconnect & lock" }))
    expect(fixture.session.disconnect).toHaveBeenCalledOnce(); expect(screen.queryByTestId("app:notes")).toBeNull()
})
